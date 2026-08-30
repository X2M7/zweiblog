const toCount = (value) => {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : 0;
};

const formatDetail = (detail) => {
  if (typeof detail === 'string') return detail.slice(0, 500);
  if (!detail || typeof detail !== 'object') return String(detail || '未知原因');
  const id = detail.id || detail.legacyId || detail.sourceId || detail.index;
  const reason = detail.reason || detail.message || detail.error || detail.status;
  if (id || reason) return `${id ? `[${id}] ` : ''}${reason || '未说明原因'}`.slice(0, 500);
  try {
    return JSON.stringify(detail).slice(0, 500);
  } catch {
    return '无法解析的迁移明细';
  }
};

export const normalizeMigrationResult = (response) => {
  const value = response?.data || response || {};
  const errors = [
    ...(Array.isArray(value.errors) ? value.errors : []),
    ...(Array.isArray(value.errorDetails) ? value.errorDetails : []),
  ].map(formatDetail);
  const skippedDetails = (Array.isArray(value.skippedDetails) ? value.skippedDetails : []).map(
    formatDetail,
  );
  return {
    sourceDatabase: value.sourceDatabase || '-',
    sourceCollection: value.sourceCollection || '-',
    scanned: toCount(value.scanned),
    created: toCount(value.created ?? value.imported),
    existing: toCount(value.existing ?? value.duplicate),
    skipped: toCount(value.skipped),
    errorCount: Math.max(toCount(value.errorCount ?? value.failed), errors.length),
    errors,
    skippedDetails,
  };
};

export const getMigrationErrorMessage = (error) =>
  error?.data?.message ||
  error?.response?.data?.message ||
  error?.message ||
  '无法连接旧 Waline 数据库，请检查服务端日志和数据库配置。';
