/** Pure geometry helpers shared by NMF SVG plots. */

export class NmfPlotGeometry {
  /** Single series; y scaled to [0, plotH] from series min/max. */
  static polylinePointsY(data: number[], plotW: number, plotH: number): string {
    if (data.length === 0) return '';
    if (data.length === 1) return `0,${plotH / 2} ${plotW},${plotH / 2}`;
    const min = Math.min(...data);
    let max = Math.max(...data);
    if (max <= min) max = min + 1e-9;
    const last = data.length - 1;
    return data
      .map((v, i) => {
        const x = (i / last) * plotW;
        const y = plotH - ((v - min) / (max - min)) * plotH;
        return `${x},${y}`;
      })
      .join(' ');
  }

  static yRange2d(rows: number[][]): { min: number; max: number } {
    let min = Infinity;
    let max = -Infinity;
    for (const row of rows) {
      for (const v of row) {
        if (v < min) min = v;
        if (v > max) max = v;
      }
    }
    if (!Number.isFinite(min) || !Number.isFinite(max)) {
      return { min: 0, max: 1 };
    }
    if (max <= min) max = min + 1e-9;
    return { min, max };
  }

  /** One series with explicit vertical scale (for overlay plots). */
  static polylinePointsYInRange(
    data: number[],
    plotW: number,
    plotH: number,
    min: number,
    max: number,
  ): string {
    if (data.length === 0) return '';
    if (data.length === 1) return `0,${plotH / 2} ${plotW},${plotH / 2}`;
    const last = data.length - 1;
    return data
      .map((v, i) => {
        const x = (i / last) * plotW;
        const y = plotH - ((v - min) / (max - min)) * plotH;
        return `${x},${y}`;
      })
      .join(' ');
  }

  /**
   * Per-trace min–max to [0, 1] for overlay plots only. NMF absorbs scale in W vs H, so raw h_init
   * (≈ O(1) after process_activation) and fitted H rows often differ by orders of magnitude.
   */
  static normalizeMinMaxSeries(data: number[]): number[] {
    if (data.length === 0) return [];
    const min = Math.min(...data);
    const max = Math.max(...data);
    if (max <= min) return data.map(() => 0.5);
    return data.map(v => (v - min) / (max - min));
  }
}
