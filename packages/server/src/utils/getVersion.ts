import axios from 'axios';
export const getVersionFromServer = async () => {
  const endpoint = process.env.ZWEI_BLOG_UPDATE_ENDPOINT?.trim();
  if (!endpoint) return null;

  let updateUrl: URL;
  try {
    updateUrl = new URL(endpoint);
    if (!['http:', 'https:'].includes(updateUrl.protocol)) return null;
  } catch {
    return null;
  }

  try {
    let { data } = await axios.get(updateUrl.toString(), {
      timeout: 1000,
    });
    data = data?.data || {};
    if (!data?.version) {
      return null;
    }
    return {
      version: data.version,
      updatedAt: data?.updatedAt || data?.upadtedAt,
    };
  } catch (err) {
    return null;
  }
};
