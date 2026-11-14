import { vi } from "vitest";

// jsdom has no canvas: the bot charts get a stand-in that accepts every call.
vi.mock("lightweight-charts", () => {
  const series = () => ({
    setData: () => undefined,
    createPriceLine: () => ({}),
    removePriceLine: () => undefined,
    applyOptions: () => undefined,
  });
  return {
    createChart: () => ({
      addSeries: series,
      remove: () => undefined,
      applyOptions: () => undefined,
      timeScale: () => ({ fitContent: () => undefined }),
    }),
    CandlestickSeries: {},
    LineSeries: {},
    LineStyle: { Solid: 0, Dotted: 1, Dashed: 2 },
  };
});

// jsdom has no modal dialogs: open and close them as the attribute.
HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
  this.setAttribute("open", "");
};
HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
  this.removeAttribute("open");
  this.dispatchEvent(new Event("close"));
};
