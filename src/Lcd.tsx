import { useEffect, useRef } from "react";

/** Seven-segment style readout drawn by the kit's RSMA.lcd. */
export function Lcd({ value, h, ghost = 0, label }: { value: string; h: number; ghost?: number; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    (window as unknown as { RSMA: { lcd: (el: HTMLElement, v: string, o: object) => void } }).RSMA.lcd(ref.current!, value, {
      h,
      skew: -4,
      ghost,
      label,
    });
  }, [value, h, ghost, label]);
  return <div className="r-lcd" ref={ref} />;
}
