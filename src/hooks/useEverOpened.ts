import { useEffect, useState } from 'react';

/** Hook: becomes true the first time `open` is true and stays true. */
export function useEverOpened(open: boolean): boolean {
  const [ever, setEver] = useState(open);
  useEffect(() => { if (open && !ever) setEver(true); }, [open, ever]);
  return ever || open;
}
