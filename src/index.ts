import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import mysql from 'mysql2/promise';
import express from 'express';
import { DB_SCHEMA_DOCS } from './schema.js';

// ---------------------------------------------------------------------------
// Server identity — configurable via MCP_SERVER_NAME env var
// URI scheme used for the schema resource: db://schema
// ---------------------------------------------------------------------------

const SERVER_NAME = process.env.MCP_SERVER_NAME ?? 'db-mcp';
const SCHEMA_URI  = 'db://schema';

// ---------------------------------------------------------------------------
// Safety guard — only allow read-only statements
// ---------------------------------------------------------------------------

const ALLOWED_PREFIXES = ['SELECT', 'SHOW', 'DESCRIBE', 'DESC', 'EXPLAIN'];
const BLOCKED_KEYWORDS = /\b(DROP|DELETE|UPDATE|INSERT|TRUNCATE|ALTER|CREATE|REPLACE|EXEC|EXECUTE|GRANT|REVOKE|LOAD|OUTFILE|DUMPFILE)\b/i;

function isSafeQuery(sql: string): { ok: boolean; reason?: string } {
  const trimmed = sql.trim();
  const upper = trimmed.toUpperCase();
  if (!ALLOWED_PREFIXES.some((p) => upper.startsWith(p))) {
    return { ok: false, reason: `Only ${ALLOWED_PREFIXES.join('/')} statements are allowed.` };
  }
  if (BLOCKED_KEYWORDS.test(trimmed)) {
    return { ok: false, reason: 'Query contains a disallowed keyword.' };
  }
  if (trimmed.replace(/;$/, '').includes(';')) {
    return { ok: false, reason: 'Multiple statements are not allowed.' };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Format query results as a plain-text table
// ---------------------------------------------------------------------------

type QueryRow = Record<string, unknown>;

function formatTable(columns: string[], rows: QueryRow[]): string {
  if (rows.length === 0) return '(no rows)';
  const widths = columns.map((col) => {
    const maxData = Math.max(...rows.map((r) => String(r[col] ?? 'NULL').length));
    return Math.max(col.length, maxData, 4);
  });
  const header = columns.map((c, i) => c.padEnd(widths[i])).join(' | ');
  const divider = widths.map((w) => '-'.repeat(w)).join('-+-');
  const dataRows = rows.map((row) =>
    columns.map((col, i) => String(row[col] ?? 'NULL').padEnd(widths[i])).join(' | ')
  );
  return [header, divider, ...dataRows].join('\n');
}

// ---------------------------------------------------------------------------
// Server factory — each connection gets its own isolated DB pool
// ---------------------------------------------------------------------------

function createMcpServer() {
  let pool: mysql.Pool | null = null;
  let connectedAs: string | null = null;

  async function initPool(host: string, port: number, user: string, password: string): Promise<void> {
    if (pool) {
      await pool.end().catch(() => {});
      pool = null;
    }
    pool = mysql.createPool({ host, port, user, password, multipleStatements: false, waitForConnections: true, connectionLimit: 5 });
    const conn = await pool.getConnection();
    conn.release();
    connectedAs = `${user}@${host}:${port}`;
  }

  function getPool(): mysql.Pool {
    if (!pool) throw new Error('Not connected. Call the "connect" tool first with your DB credentials.');
    return pool;
  }

  async function runQuery(sql: string): Promise<{ columns: string[]; rows: QueryRow[] }> {
    const [rows, fields] = (await getPool().query(sql)) as [QueryRow[], mysql.FieldPacket[]];
    const columns = fields?.map((f) => f.name) ?? Object.keys(rows[0] ?? {});
    return { columns, rows };
  }

  // Auto-connect from env vars if provided
  if (process.env.DB_HOST && process.env.DB_USER && process.env.DB_PASS) {
    initPool(
      process.env.DB_HOST,
      parseInt(process.env.DB_PORT ?? ''),
      process.env.DB_USER,
      process.env.DB_PASS,
    ).catch(() => {});
  }

  const server = new Server(
    { name: SERVER_NAME, version: '1.0.0' },
    { capabilities: { tools: {}, resources: {} } }
  );

  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: [{
      uri: SCHEMA_URI,
      name: 'Database Schema Overview',
      description: 'Full documentation of all databases, tables, their purposes, and common join patterns',
      mimeType: 'text/markdown',
    }],
  }));

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    if (request.params.uri === SCHEMA_URI) {
      return { contents: [{ uri: SCHEMA_URI, mimeType: 'text/markdown', text: DB_SCHEMA_DOCS }] };
    }
    throw new Error(`Unknown resource: ${request.params.uri}`);
  });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: 'connect',
        description: 'Connect to a MySQL database server with your credentials. Must be called before using any other tool.',
        inputSchema: {
          type: 'object',
          properties: {
            host:     { type: 'string', description: 'MySQL host (IP or hostname)' },
            port:     { type: 'number', description: 'MySQL port' },
            user:     { type: 'string', description: 'MySQL username' },
            password: { type: 'string', description: 'MySQL password' },
          },
          required: ['host', 'user', 'password'],
        },
      },
      {
        name: 'connection_status',
        description: 'Check whether you are currently connected to a database server.',
        inputSchema: { type: 'object', properties: {} },
      },
      {
        name: 'list_databases',
        description: 'List all available MySQL databases (excludes system databases).',
        inputSchema: { type: 'object', properties: {} },
      },
      {
        name: 'list_tables',
        description: 'List all tables in a specific database.',
        inputSchema: {
          type: 'object',
          properties: { database: { type: 'string', description: 'Database name' } },
          required: ['database'],
        },
      },
      {
        name: 'describe_table',
        description: 'Show the column structure of a specific table.',
        inputSchema: {
          type: 'object',
          properties: {
            database: { type: 'string', description: 'Database name' },
            table:    { type: 'string', description: 'Table name' },
          },
          required: ['database', 'table'],
        },
      },
      {
        name: 'query',
        description:
          'Execute a read-only SQL query (SELECT / SHOW / DESCRIBE only). ' +
          'Use fully qualified table names (database.table) for cross-database JOINs. ' +
          'A LIMIT is automatically appended if not already present.',
        inputSchema: {
          type: 'object',
          properties: {
            sql:   { type: 'string', description: 'SQL query to execute' },
            limit: { type: 'number', description: 'Maximum rows to return (default: 50, max: 500)' },
          },
          required: ['sql'],
        },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    try {
      if (name === 'connect') {
        const host     = String(args?.host ?? '').trim();
        const port     = Number(args?.port ?? 3306);
        const user     = String(args?.user ?? '').trim();
        const password = String(args?.password ?? '');
        if (!host || !user) throw new Error('host and user are required');
        await initPool(host, port, user, password);
        return { content: [{ type: 'text', text: `Connected successfully as ${connectedAs}` }] };
      }

      if (name === 'connection_status') {
        if (!pool) return { content: [{ type: 'text', text: 'Not connected. Call the "connect" tool with your host, user, and password.' }] };
        return { content: [{ type: 'text', text: `Connected as ${connectedAs}` }] };
      }

      if (name === 'list_databases') {
        const { rows } = await runQuery('SHOW DATABASES');
        const systemDbs = new Set(['information_schema', 'performance_schema', 'mysql', 'sys']);
        const dbs = rows.map((r) => String(Object.values(r)[0])).filter((db) => !systemDbs.has(db));
        return { content: [{ type: 'text', text: `Available databases (${dbs.length}):\n\n${dbs.join('\n')}` }] };
      }

      if (name === 'list_tables') {
        const db = String(args?.database ?? '');
        if (!db) throw new Error('database is required');
        const key = Object.keys((await runQuery(`SHOW TABLES FROM \`${db}\``)).rows[0] ?? {})[0] ?? 'Tables';
        const { rows } = await runQuery(`SHOW TABLES FROM \`${db}\``);
        const tables = rows.map((r) => String(r[key] ?? Object.values(r)[0]));
        return { content: [{ type: 'text', text: `Tables in \`${db}\` (${tables.length}):\n\n${tables.join('\n')}` }] };
      }

      if (name === 'describe_table') {
        const db    = String(args?.database ?? '');
        const table = String(args?.table ?? '');
        if (!db || !table) throw new Error('database and table are required');
        const { rows } = await runQuery(`DESCRIBE \`${db}\`.\`${table}\``);
        const lines = rows.map((r) => {
          const field    = String(r['Field'] ?? '');
          const type     = String(r['Type'] ?? '');
          const nullable = r['Null'] === 'YES' ? 'NULL' : 'NOT NULL';
          const key      = r['Key'] ? ` [${r['Key']}]` : '';
          const def      = r['Default'] != null ? ` DEFAULT ${r['Default']}` : '';
          return `  ${field.padEnd(35)} ${type.padEnd(25)} ${nullable}${key}${def}`;
        });
        return { content: [{ type: 'text', text: `Structure of \`${db}\`.\`${table}\`:\n\n${lines.join('\n')}` }] };
      }

      if (name === 'query') {
        const sql = String(args?.sql ?? '').trim();
        if (!sql) throw new Error('sql is required');
        const safety = isSafeQuery(sql);
        if (!safety.ok) return { content: [{ type: 'text', text: `Blocked: ${safety.reason}` }], isError: true };
        const limit    = Math.min(Math.max(1, Number(args?.limit ?? 50)), 500);
        const finalSql = /\bLIMIT\b/i.test(sql) ? sql : `${sql} LIMIT ${limit}`;
        const { columns, rows } = await runQuery(finalSql);
        if (rows.length === 0) return { content: [{ type: 'text', text: 'Query returned no results.' }] };
        const tableStr = formatTable(columns, rows);
        const suffix   = rows.length === limit ? `\n\n(showing first ${limit} rows — pass a higher limit or add LIMIT to your query)` : '';
        return { content: [{ type: 'text', text: `${rows.length} row(s):\n\n${tableStr}${suffix}` }] };
      }

      return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true };

    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { content: [{ type: 'text', text: `Error: ${msg}` }], isError: true };
    }
  });

  return server;
}

// ---------------------------------------------------------------------------
// Start — stdio mode (local) or HTTP/SSE mode (deployed)
// ---------------------------------------------------------------------------

const PORT = process.env.PORT;

if (PORT) {
  // ── HTTP / SSE mode (Render, Railway, etc.) ────────────────────────────────
  const app = express();
  app.use(express.json());

  // Track active SSE transports by session
  const sessions = new Map<string, SSEServerTransport>();

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', mode: 'sse', sessions: sessions.size });
  });

  app.get('/sse', async (req, res) => {
    const transport = new SSEServerTransport('/message', res);
    sessions.set(transport.sessionId, transport);

    req.on('close', () => {
      sessions.delete(transport.sessionId);
    });

    const server = createMcpServer();
    await server.connect(transport);
  });

  app.post('/message', async (req, res) => {
    const sessionId = req.query.sessionId as string;
    const transport = sessions.get(sessionId);
    if (!transport) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    await transport.handlePostMessage(req, res);
  });

  app.listen(parseInt(PORT), () => {
    process.stderr.write(`${SERVER_NAME} HTTP server running on port ${PORT}\n`);
  });

} else {
  // ── Stdio mode (local VS Code) ─────────────────────────────────────────────
  const server    = createMcpServer();
  const transport = new StdioServerTransport();
  server.connect(transport).then(() => {
    process.stderr.write(`${SERVER_NAME} stdio server running\n`);
  }).catch((err) => {
    process.stderr.write(`Fatal: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
}
