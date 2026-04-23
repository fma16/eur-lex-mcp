const LEVELS = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3
};

export function createLogger(rawLevel = "info") {
  const level = LEVELS[rawLevel] !== undefined ? rawLevel : "info";
  const threshold = LEVELS[level];

  function shouldLog(candidate) {
    return LEVELS[candidate] <= threshold;
  }

  function serialize(meta) {
    if (!meta) return "";
    try {
      return ` ${JSON.stringify(meta)}`;
    } catch {
      return "";
    }
  }

  return {
    level,
    error(message, meta) {
      if (!shouldLog("error")) return;
      console.error(`[error] ${message}${serialize(meta)}`);
    },
    warn(message, meta) {
      if (!shouldLog("warn")) return;
      console.error(`[warn] ${message}${serialize(meta)}`);
    },
    info(message, meta) {
      if (!shouldLog("info")) return;
      console.error(`[info] ${message}${serialize(meta)}`);
    },
    debug(message, meta) {
      if (!shouldLog("debug")) return;
      console.error(`[debug] ${message}${serialize(meta)}`);
    }
  };
}
