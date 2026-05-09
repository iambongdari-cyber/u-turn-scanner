'use client';

import { useEffect, useRef } from 'react';
import { createChart, ColorType, IChartApi } from 'lightweight-charts';

interface CandleData { time: string; open: number; high: number; low: number; close: number; }
interface LineData { time: string; value: number; }
interface VolumeData { time: string; value: number; color: string; }
interface Marker {
  time: string;
  position: 'belowBar' | 'aboveBar';
  color: string;
  shape: 'arrowUp' | 'arrowDown';
  text: string;
}

interface ChartProps {
  candles: CandleData[];
  ma10: LineData[];
  ma20: LineData[];
  ma60: LineData[];
  volumes: VolumeData[];
  goldenMarkers: Marker[];
}

export default function Chart({
  candles, ma10, ma20, ma60, volumes, goldenMarkers,
}: ChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      width: containerRef.current.clientWidth,
      height: 500,
      layout: {
        background: { type: ColorType.Solid, color: '#ffffff' },
        textColor: '#334155',
      },
      grid: {
        vertLines: { color: '#f1f5f9' },
        horzLines: { color: '#f1f5f9' },
      },
      timeScale: { timeVisible: true, secondsVisible: false },
    });
    chartRef.current = chart;

    // 캔들
    const candleSeries = chart.addCandlestickSeries({
      upColor: '#ef4444',     // 양봉 빨강 (한국식)
      downColor: '#3b82f6',   // 음봉 파랑
      borderVisible: false,
      wickUpColor: '#ef4444',
      wickDownColor: '#3b82f6',
    });
    candleSeries.setData(candles as any);
    if (goldenMarkers.length > 0) {
      candleSeries.setMarkers(goldenMarkers as any);
    }

    // 이평선
    const ma10Series = chart.addLineSeries({
      color: '#f59e0b', lineWidth: 1,
      priceLineVisible: false, lastValueVisible: false,
    });
    ma10Series.setData(ma10 as any);

    const ma20Series = chart.addLineSeries({
      color: '#10b981', lineWidth: 1,
      priceLineVisible: false, lastValueVisible: false,
    });
    ma20Series.setData(ma20 as any);

    const ma60Series = chart.addLineSeries({
      color: '#8b5cf6', lineWidth: 2,
      priceLineVisible: false, lastValueVisible: false,
    });
    ma60Series.setData(ma60 as any);

    // 거래량 (별도 가격축, 하단 20%만 차지)
    const volumeSeries = chart.addHistogramSeries({
      color: '#94a3b8',
      priceFormat: { type: 'volume' },
      priceScaleId: 'volume',
    });
    chart.priceScale('volume').applyOptions({
      scaleMargins: { top: 0.8, bottom: 0 },
    });
    volumeSeries.setData(volumes as any);

    chart.timeScale().fitContent();

    // 리사이즈 대응
    const handleResize = () => {
      if (containerRef.current && chartRef.current) {
        chartRef.current.applyOptions({ width: containerRef.current.clientWidth });
      }
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      chart.remove();
      chartRef.current = null;
    };
  }, [candles, ma10, ma20, ma60, volumes, goldenMarkers]);

  return (
    <div>
      <div ref={containerRef} className="rounded border border-slate-200" />
      <div className="mt-2 flex flex-wrap gap-4 text-xs text-slate-600">
        <Legend color="#f59e0b" label="10일선" />
        <Legend color="#10b981" label="20일선" />
        <Legend color="#8b5cf6" label="60일선" />
        <span className="text-red-500">↑ GC = 골든크로스</span>
      </div>
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center">
      <span
        className="mr-1 inline-block h-0.5 w-3 align-middle"
        style={{ backgroundColor: color }}
      />
      {label}
    </span>
  );
}