// ASCII-only prefixed console wrapper. Windows PowerShell defaults to cp1252
// and blows up on some unicode; keep prefixes plain to protect the demo.
const ts = () => new Date().toISOString();

const write = (level, args) => {
  const line = `[${ts()}] [${level}]`;
  // eslint-disable-next-line no-console
  console.log(line, ...args);
};

export const logger = {
  info: (...args) => write("INFO", args),
  warn: (...args) => write("WARN", args),
  error: (...args) => write("ERROR", args),
  debug: (...args) => {
    if (process.env.DEBUG) write("DEBUG", args);
  },
};
