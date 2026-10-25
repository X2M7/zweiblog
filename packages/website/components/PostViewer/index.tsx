import React, { useContext, useEffect, useState } from 'react';
import { getArticleViewer } from '../../api/getArticleViewer';
import { GlobalContext } from '../../utils/globalContext';

export default function PostViewer({ id }: { id: number | string }) {
  const { state } = useContext(GlobalContext);
  const [result, setResult] = useState({ id, viewer: 0 });

  useEffect(() => {
    let active = true;
    // _app records the visit and publishes a new global state only after the
    // response. Re-read the persisted article count then, without adding one
    // in the UI. Depend on the state object: concurrent visits can return the
    // same global counter but each completed write still needs a fresh read.
    getArticleViewer(id)
      .then((data) => {
        if (!active) return;
        const count = Number(data?.viewer ?? 0);
        setResult({
          id,
          viewer: Number.isFinite(count) ? Math.max(0, Math.trunc(count)) : 0,
        });
      })
      .catch(() => {
        // A temporary statistics failure must not break the article or invent
        // a visit. Keep the last confirmed count for this article, if any.
      });
    return () => {
      active = false;
    };
  }, [id, state]);

  return <span>{result.id === id ? result.viewer : 0}</span>;
}
