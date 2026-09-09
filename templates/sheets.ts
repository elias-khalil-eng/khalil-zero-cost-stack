// Google Sheets data layer. The spreadsheet is the app's database: one tab
// per table, first row is the header. Auth is a hand-rolled service-account
// JWT (RS256 via node:crypto) exchanged for an access token — no SDK needed.

import { createSign } from 'node:crypto'
import { ConfigurationError } from './errors'

const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const SHEETS_BASE = 'https://sheets.googleapis.com/v4/spreadsheets'
const SCOPE = 'https://www.googleapis.com/auth/spreadsheets'

export const TABS = {
  // Columns are read by POSITION (see readTable), so new ones only ever get
  // appended — inserting mid-list would shift every existing row's data.
  // Replace these with your own entities. The shapes show the conventions:
  // Id first, CreatedAtUtc for audit, DeletedAtUtc last for soft delete.
  Records: ['Id', 'CreatedAtUtc', 'FullName', 'Phone', 'StartDate', 'EndDate', 'Location', 'ItemName', 'ItemPrice', 'Notes', 'Deposit', 'ImportedSheetRow', 'DeletedAtUtc', 'ClientDraftId'],
  Payments: ['Id', 'RecordId', 'Amount', 'Method', 'ReceiptNumber', 'PaidOn', 'Notes', 'CreatedAtUtc'],
  Expenses: ['Id', 'Year', 'Month', 'Category', 'Amount', 'Notes', 'UpdatedAtUtc'],
  ExpenseCategories: ['Id', 'Name', 'SortOrder'],
  Catalog: ['Id', 'Type', 'Name'],
  Users: ['Username', 'PasswordHash', 'Role', 'IsDisabled', 'CreatedAtUtc'],
  ClientDrafts: ['Id', 'Status', 'ValuesJson', 'EditableFieldsJson', 'SubmittedValuesJson', 'TokenHash', 'CreatedAtUtc', 'UpdatedAtUtc', 'ExpiresAtUtc', 'SubmittedAtUtc', 'DecidedAtUtc', 'DecidedBy', 'RejectionReason', 'RecordId', 'Version', 'SubmittedVersion', 'DeletedAtUtc'],
  // Child table: one row per Record. Keep its column order fixed and documented
  // in one place, so the domain module and this schema can never drift apart.
  RecordDetails: ['Id', 'RecordId', 'FieldA', 'FieldB', 'FieldC', 'Notes', 'UpdatedBy', 'UpdatedAtUtc'],
} as const

export type TabName = keyof typeof TABS

export type TableRow = {
  /** 1-based sheet row number (header is row 1). */
  rowNumber: number
  /** Cell text by header name; empty string for blank/missing cells. */
  cells: Record<string, string>
}

function b64url(data: Buffer | string): string {
  return Buffer.from(data).toString('base64url')
}

type ServiceAccount = { client_email: string; private_key: string }

function loadServiceAccount(): ServiceAccount {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON
  if (!raw || !raw.trim()) {
    throw new ConfigurationError(
      'Google service account credentials are not configured. Set the GOOGLE_SERVICE_ACCOUNT_JSON environment variable.')
  }
  const text = raw.trim().startsWith('{')
    ? raw
    : Buffer.from(raw, 'base64').toString('utf8')
  try {
    const sa = JSON.parse(text)
    if (!sa.client_email || !sa.private_key) throw new Error('missing fields')
    return sa
  } catch {
    throw new ConfigurationError(
      'GOOGLE_SERVICE_ACCOUNT_JSON is not a valid service-account key (expected the raw JSON or base64 of it).')
  }
}

let cachedToken: { token: string; expiresAt: number } | null = null

async function getAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt - 60_000) {
    return cachedToken.token
  }

  const sa = loadServiceAccount()
  const now = Math.floor(Date.now() / 1000)
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const claims = b64url(JSON.stringify({
    iss: sa.client_email,
    scope: SCOPE,
    aud: TOKEN_URL,
    iat: now,
    exp: now + 3600,
  }))
  const signer = createSign('RSA-SHA256')
  signer.update(`${header}.${claims}`)
  const signature = signer.sign(sa.private_key).toString('base64url')
  const assertion = `${header}.${claims}.${signature}`

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  })
  if (!res.ok) {
    throw new ConfigurationError(`Google token exchange failed (${res.status}): ${await res.text()}`)
  }
  const data = await res.json() as { access_token: string; expires_in: number }
  cachedToken = { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 }
  return data.access_token
}

async function sheetsFetch(path: string, init: RequestInit = {}): Promise<any> {
  const token = await getAccessToken()
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    ...(init.body ? { 'Content-Type': 'application/json' } : {}),
  }
  const res = await fetch(`${SHEETS_BASE}${path}`, { ...init, headers })
  if (!res.ok) {
    const body = await res.text()
    if (res.status === 403 || res.status === 404) {
      throw new ConfigurationError(
        `Google Sheets request failed (${res.status}). Check that SPREADSHEET_ID is correct and the sheet is shared with the service account as Editor. ${body}`)
    }
    throw new Error(`Google Sheets request failed (${res.status}): ${body}`)
  }
  return res.json()
}

function spreadsheetId(): string {
  const id = process.env.SPREADSHEET_ID
  if (!id || !id.trim()) {
    throw new ConfigurationError('SPREADSHEET_ID environment variable is not set.')
  }
  return id.trim()
}

// UNFORMATTED_VALUE returns numbers for numeric cells; minimal JS formatting
// keeps serial dates as "46282" not "46282.0" so parseDateLoose sees the same
// strings the old apps did.
export function cellText(cell: unknown): string {
  if (cell === null || cell === undefined) return ''
  if (typeof cell === 'number') return String(cell)
  return String(cell).trim()
}

function columnLetter(n: number): string {
  let s = ''
  while (n > 0) {
    const rem = (n - 1) % 26
    s = String.fromCharCode(65 + rem) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}

// ---------------------------------------------------------------------------
// Schema bootstrap: create missing tabs + header rows once per cold start.

let ensured = false
let ensuring: Promise<void> | null = null
let sheetIdByTitle: Record<string, number> = {}

/**
 * Bootstrap runs at most once, and concurrent callers share the one run.
 *
 * `ensured` can only flip after two awaits, so without this every request
 * in flight sees the same tab missing and issues its own addSheet for it.
 * Google settles the duplicate title by keeping one sheet and forking the
 * rest as empty "<title>_conflict<id>" copies. A page load fires several API
 * calls at once, so this bites whenever TABS gains a tab.
 */
export function ensureSchema(): Promise<void> {
  if (ensured) return Promise.resolve()
  if (!ensuring) {
    ensuring = bootstrapSchema().then(
      () => { ensured = true; ensuring = null },
      err => { ensuring = null; throw err },
    )
  }
  return ensuring
}

async function bootstrapSchema(): Promise<void> {
  const id = spreadsheetId()
  const meta = await sheetsFetch(`/${id}?fields=sheets.properties`)
  sheetIdByTitle = {}
  for (const sheet of meta.sheets ?? []) {
    sheetIdByTitle[sheet.properties.title] = sheet.properties.sheetId
  }

  const missing = (Object.keys(TABS) as TabName[]).filter(t => !(t in sheetIdByTitle))
  if (missing.length > 0) {
    const result = await sheetsFetch(`/${id}:batchUpdate`, {
      method: 'POST',
      body: JSON.stringify({
        requests: missing.map(title => ({ addSheet: { properties: { title } } })),
      }),
    })
    for (const reply of result.replies ?? []) {
      const props = reply.addSheet?.properties
      if (props) sheetIdByTitle[props.title] = props.sheetId
    }
    for (const title of missing) {
      await writeHeader(id, title)
    }
  }

  await repairHeaders(id, (Object.keys(TABS) as TabName[]).filter(t => !missing.includes(t)))
}

async function writeHeader(id: string, tab: TabName): Promise<void> {
  const headers = TABS[tab]
  await sheetsFetch(
    `/${id}/values/${encodeURIComponent(`${tab}!A1:${columnLetter(headers.length)}1`)}?valueInputOption=RAW`,
    { method: 'PUT', body: JSON.stringify({ values: [headers as unknown as string[]] }) },
  )
}

/**
 * Bring the header row of already-existing tabs up to date. Rows are read by
 * position, so a tab created before a column was appended still reads fine —
 * but its header row would be missing the new name. Only an empty suffix is
 * extended; mismatched or occupied columns fail without changing the sheet.
 */
async function repairHeaders(id: string, tabs: TabName[]): Promise<void> {
  if (tabs.length === 0) return

  const ranges = tabs
    .map(t => `ranges=${encodeURIComponent(`${t}!A1:${columnLetter(TABS[t].length)}1`)}`)
    .join('&')
  const data = await sheetsFetch(`/${id}/values:batchGet?${ranges}`)
  const valueRanges: { values?: unknown[][] }[] = data.valueRanges ?? []

  for (let i = 0; i < tabs.length; i++) {
    const tab = tabs[i]
    const expected = TABS[tab]
    const actual = (valueRanges[i]?.values?.[0] ?? []).map(cellText)
    if (expected.every((header, column) => actual[column] === header)) continue

    // Only an exact old prefix can be upgraded automatically. A mismatch may
    // be a user's custom column, so fail instead of silently relabeling data.
    const isExactPrefix = actual.length <= expected.length
      && actual.every((header, column) => header === expected[column])
    if (!isExactPrefix) {
      throw new ConfigurationError(
        `The ${tab} sheet headers do not match the app schema. No headers were overwritten; move custom columns out of the app-managed range and try again.`)
    }

    const firstNewColumn = actual.length + 1
    const tailRange = `${tab}!${columnLetter(firstNewColumn)}2:${columnLetter(expected.length)}`
    const tail = await sheetsFetch(
      `/${id}/values/${encodeURIComponent(tailRange)}?valueRenderOption=UNFORMATTED_VALUE`)
    const tailHasData = (tail.values ?? []).some((row: unknown[]) =>
      row.some(cell => cellText(cell).length > 0))
    if (tailHasData) {
      throw new ConfigurationError(
        `The ${tab} sheet uses columns reserved by this app update. No data was changed; move those values to a separate tab before restarting.`)
    }

    const headerRange = `${tab}!${columnLetter(firstNewColumn)}1:${columnLetter(expected.length)}1`
    await sheetsFetch(
      `/${id}/values/${encodeURIComponent(headerRange)}?valueInputOption=RAW`,
      { method: 'PUT', body: JSON.stringify({ values: [expected.slice(actual.length)] }) },
    )
  }
}

async function getSheetId(tab: TabName): Promise<number> {
  await ensureSchema()
  const sheetId = sheetIdByTitle[tab]
  if (sheetId === undefined) throw new Error(`Sheet tab not found: ${tab}`)
  return sheetId
}

// ---------------------------------------------------------------------------
// Row operations.

export async function readTable(tab: TabName): Promise<TableRow[]> {
  await ensureSchema()
  const id = spreadsheetId()
  const headers = TABS[tab]
  const range = encodeURIComponent(`${tab}!A2:${columnLetter(headers.length)}`)
  const data = await sheetsFetch(
    `/${id}/values/${range}?valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=SERIAL_NUMBER`)

  const rows: TableRow[] = []
  const values: unknown[][] = data.values ?? []
  for (let i = 0; i < values.length; i++) {
    const raw = values[i]
    if (!raw.some(cell => cellText(cell).length > 0)) continue
    const cells: Record<string, string> = {}
    headers.forEach((h, col) => {
      cells[h] = col < raw.length ? cellText(raw[col]) : ''
    })
    rows.push({ rowNumber: i + 2, cells })
  }
  return rows
}

/** Reads one exact data row without scanning the whole table. */
export async function readTableRow(tab: TabName, rowNumber: number): Promise<TableRow | null> {
  if (!Number.isInteger(rowNumber) || rowNumber < 2) return null
  await ensureSchema()
  const id = spreadsheetId()
  const headers = TABS[tab]
  const range = encodeURIComponent(
    `${tab}!A${rowNumber}:${columnLetter(headers.length)}${rowNumber}`)
  const data = await sheetsFetch(
    `/${id}/values/${range}?valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=SERIAL_NUMBER`)
  const raw: unknown[] = data.values?.[0] ?? []
  if (!raw.some(cell => cellText(cell).length > 0)) return null
  const cells: Record<string, string> = {}
  headers.forEach((header, column) => {
    cells[header] = column < raw.length ? cellText(raw[column]) : ''
  })
  return { rowNumber, cells }
}

/** Values are written RAW so ISO date strings stay strings, never coerced. */
export async function appendRow(tab: TabName, values: (string | number)[]): Promise<void> {
  await appendRows(tab, [values])
}

/** Appends many rows in a single API call (one call per 500-row chunk). */
export async function appendRows(tab: TabName, rows: (string | number)[][]): Promise<void> {
  if (rows.length === 0) return
  await ensureSchema()
  const id = spreadsheetId()
  const headers = TABS[tab]
  const range = encodeURIComponent(`${tab}!A1:${columnLetter(headers.length)}1`)
  for (let i = 0; i < rows.length; i += 500) {
    await sheetsFetch(
      `/${id}/values/${range}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
      { method: 'POST', body: JSON.stringify({ values: rows.slice(i, i + 500) }) },
    )
  }
}

export async function updateRow(tab: TabName, rowNumber: number, values: (string | number)[]): Promise<void> {
  await ensureSchema()
  const id = spreadsheetId()
  const headers = TABS[tab]
  const range = encodeURIComponent(`${tab}!A${rowNumber}:${columnLetter(headers.length)}${rowNumber}`)
  await sheetsFetch(
    `/${id}/values/${range}?valueInputOption=RAW`,
    { method: 'PUT', body: JSON.stringify({ values: [values] }) },
  )
}

export type CellUpdate = {
  tab: TabName
  rowNumber: number
  /** One-based column number. */
  columnNumber: number
  value: string | number
}

/**
 * Writes selected cells in one atomic spreadsheets.batchUpdate call. Unlike
 * updateRow, this never replaces neighboring cells, so a client approval can't
 * roll back an owner's unrelated record edits made after the link was sent.
 */
export async function updateCells(updates: CellUpdate[]): Promise<void> {
  if (updates.length === 0) return
  await ensureSchema()
  const id = spreadsheetId()
  const sheetIds = new Map<TabName, number>()
  for (const tab of new Set(updates.map(update => update.tab))) {
    sheetIds.set(tab, await getSheetId(tab))
  }
  await sheetsFetch(`/${id}:batchUpdate`, {
    method: 'POST',
    body: JSON.stringify({
      requests: updates.map(update => ({
        updateCells: {
          range: {
            sheetId: sheetIds.get(update.tab),
            startRowIndex: update.rowNumber - 1,
            endRowIndex: update.rowNumber,
            startColumnIndex: update.columnNumber - 1,
            endColumnIndex: update.columnNumber,
          },
          rows: [{ values: [{ userEnteredValue: typeof update.value === 'number'
            ? { numberValue: update.value }
            : { stringValue: update.value } }] }],
          fields: 'userEnteredValue',
        },
      })),
    }),
  })
}

export async function deleteRow(tab: TabName, rowNumber: number): Promise<void> {
  const id = spreadsheetId()
  const sheetId = await getSheetId(tab)
  await sheetsFetch(`/${id}:batchUpdate`, {
    method: 'POST',
    body: JSON.stringify({
      requests: [{
        deleteDimension: {
          range: { sheetId, dimension: 'ROWS', startIndex: rowNumber - 1, endIndex: rowNumber },
        },
      }],
    }),
  })
}

export function nextId(rows: TableRow[]): number {
  let max = 0
  for (const row of rows) {
    const id = Number(row.cells['Id'])
    if (Number.isFinite(id) && id > max) max = id
  }
  return max + 1
}

// ---------------------------------------------------------------------------
// Read-only snapshot of the OLD Google Form responses sheet (for the one-time
// import). Reads the first tab and returns header + rows like the C# reader.

export async function readImportSheet(importSpreadsheetId: string): Promise<{
  title: string
  header: string[]
  rows: string[][]
}> {
  const meta = await sheetsFetch(`/${importSpreadsheetId}?fields=sheets.properties`)
  const title: string | undefined = meta.sheets?.[0]?.properties?.title
  if (!title) throw new ConfigurationError('The import spreadsheet has no sheets.')

  const range = encodeURIComponent(`'${title.replace(/'/g, "''")}'!A:Z`)
  const data = await sheetsFetch(
    `/${importSpreadsheetId}/values/${range}?valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=SERIAL_NUMBER`)
  const values: unknown[][] = data.values ?? []
  if (values.length === 0) return { title, header: [], rows: [] }

  return {
    title,
    header: values[0].map(cellText),
    rows: values.slice(1).map(row => row.map(cellText)),
  }
}
