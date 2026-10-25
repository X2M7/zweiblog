import { isRequestRenderedArticlePath } from "../../utils/requestPageProps";

export default async function handler(req: any, res: any) {
  // 因为 /api 只会暴露 server 的，这个不会暴漏到容器外，就不验证了。

  const path = req.query?.path;
  // console.log("触发增量渲染", path);
  if (!path) {
    return res.status(500).send("触发增量增量渲染失败");
  }
  if (typeof path === "string" && isRequestRenderedArticlePath(path)) {
    // These pages have no ISR entry. Old backend versions may still ask to
    // revalidate them; acknowledge without invoking Next's SSG-only API.
    return res.json({ revalidated: false, requestRendered: true });
  }
  try {
    await res.revalidate(path);
    return res.json({ revalidated: true });
  } catch (err) {
    // If there was an error, Next.js will continue
    // to show the last successfully generated page
    console.log(err);
    return res.status(500).send("触发增量增量渲染失败");
  }
}
