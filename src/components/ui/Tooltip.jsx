
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export default function Tooltip({ text, children }) {
  const triggerRef = useRef(null);
  const tooltipRef = useRef(null);
  const [visible, setVisible] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });

  useEffect(() => {
    if (!visible || !text) return;

    const updatePosition = () => {
      const trigger = triggerRef.current;
      const tooltip = tooltipRef.current;

      if (!trigger || !tooltip) return;

      const rect = trigger.getBoundingClientRect();
      const tipRect = tooltip.getBoundingClientRect();

      const left = Math.max(
        8,
        Math.min(
          rect.left + rect.width / 2 - tipRect.width / 2,
          window.innerWidth - tipRect.width - 8
        )
      );

      const top = rect.bottom + 8;
      
      setPosition({ top, left });
    };

    updatePosition();

    window.addEventListener("scroll", updatePosition, true);
    window.addEventListener("resize", updatePosition);

    return () => {
      window.removeEventListener("scroll", updatePosition, true);
      window.removeEventListener("resize", updatePosition);
    };
  }, [visible, text]);

  return (
    <>
      <span
        ref={triggerRef}
        className="custom-tooltip-trigger"
        onMouseEnter={() => setVisible(true)}
        onMouseLeave={() => setVisible(false)}
        onFocus={() => setVisible(true)}
        onBlur={() => setVisible(false)}
      >
        {children}
      </span>

      {visible &&
        text &&
        createPortal(
          <span
            ref={tooltipRef}
            className="custom-tooltip"
            role="tooltip"
            style={{
              top: position.top,
              left: position.left,
            }}
          >
            {text}
          </span>,
          document.body
        )}
    </>
  );
}
