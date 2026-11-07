/** A synchronous lease prevents double clicks and late work from an old run. */
export function createReviewRunGate() {
  let active: AbortController | null = null;
  return {
    isActive: () => active !== null,
    begin() {
      if (active) return null;
      const controller = new AbortController();
      active = controller;
      return {
        controller,
        isCurrent: () => active === controller && !controller.signal.aborted,
        finish() {
          if (active === controller) active = null;
        },
      };
    },
    cancel() {
      const previous = active;
      active = null;
      previous?.abort();
    },
  };
}
