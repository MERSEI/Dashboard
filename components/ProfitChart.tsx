"use client";

import React, {
  useState,
  useTransition,
  useMemo,
  useCallback,
  useRef,
  useEffect,
} from "react";
import { motion, AnimatePresence } from "framer-motion";
import NumberFlow from "@number-flow/react";
import { getChartData } from "@/app/actions";

interface ChartDataPoint {
  value: number;
  timestamp: number;
}

interface ProfitChartProps {
  initialData: ChartDataPoint[];
  publicKey: string;
  initialProfit: number;
}

const periods: Array<"1H" | "6H" | "1D" | "1W" | "1M" | "All"> = [
  "1H",
  "6H",
  "1D",
  "1W",
  "1M",
  "All",
];

export default function ProfitChart({
  initialData,
  publicKey,
  initialProfit,
}: ProfitChartProps) {
  const [selectedPeriod, setSelectedPeriod] =
    useState<(typeof periods)[number]>("1D");
  const [chartData, setChartData] = useState<ChartDataPoint[]>(initialData);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [isPending, startTransition] = useTransition();
  const svgRef = useRef<SVGSVGElement>(null);

  // Сбрасываем hover при любом изменении данных
  useEffect(() => {
    setHoveredIndex(null);
  }, [chartData]);

  const handlePeriodChange = useCallback(
    async (period: (typeof periods)[number]) => {
      // Сразу сбрасываем hover перед загрузкой
      setHoveredIndex(null);
      setSelectedPeriod(period);

      startTransition(async () => {
        try {
          const data = await getChartData(publicKey, period);
          if (Array.isArray(data) && data.length > 0) {
            setChartData(data);
            // hover сбросится через useEffect выше
          }
        } catch (err) {
          console.error("Failed to fetch chart:", err);
        }
      });
    },
    [publicKey],
  );

  // Добавляем уникальные ID и X позиции
  const pointsWithCoords = useMemo(() => {
    if (!chartData.length || chartData.length < 2) return [];

    const max = Math.max(...chartData.map((d) => d.value));
    const min = Math.min(...chartData.map((d) => d.value));
    const range = max - min || 1;

    return chartData.map((point, i) => ({
      ...point,
      id: `${selectedPeriod}-${i}`, // Уникальный ID включает период!
      x: (i / (chartData.length - 1)) * 100,
      y: 100 - ((point.value - min) / range) * 100,
      index: i,
    }));
  }, [chartData, selectedPeriod]);

  // SVG path
  const { svgPath, areaPath } = useMemo(() => {
    if (!pointsWithCoords.length) return { svgPath: "", areaPath: "" };

    const linePath = pointsWithCoords.reduce((acc, point, i) => {
      if (i === 0) return `M ${point.x} ${point.y}`;
      const prev = pointsWithCoords[i - 1];
      const cp1x = prev.x + (point.x - prev.x) / 3;
      const cp1y = prev.y;
      const cp2x = point.x - (point.x - prev.x) / 3;
      const cp2y = point.y;
      return `${acc} C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${point.x} ${point.y}`;
    }, "");

    const area = `${linePath} L 100 100 L 0 100 Z`;
    return { svgPath: linePath, areaPath: area };
  }, [pointsWithCoords]);

  // Форматирование даты
  const formatDate = useCallback((timestamp: number): string => {
    const date = new Date(timestamp);
    return date.toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }, []);

  const formatPeriodLabel = useCallback(
    (period: string): string =>
      ({
        "1H": "Past Hour",
        "6H": "Past 6 Hours",
        "1D": "Past Day",
        "1W": "Past Week",
        "1M": "Past Month",
        All: "All Time",
      })[period] || "Past Day",
    [],
  );

  // Текущее отображаемое значение — всегда валидное
  const displayValue = useMemo(() => {
    // Если hover активен и индекс валиден — показываем точку
    if (
      hoveredIndex !== null &&
      hoveredIndex >= 0 &&
      hoveredIndex < pointsWithCoords.length
    ) {
      return pointsWithCoords[hoveredIndex].value;
    }
    // Иначе показываем initialProfit
    return initialProfit;
  }, [hoveredIndex, pointsWithCoords, initialProfit]);

  const displayLabel = useMemo(() => {
    if (
      hoveredIndex !== null &&
      hoveredIndex >= 0 &&
      hoveredIndex < pointsWithCoords.length
    ) {
      return formatDate(pointsWithCoords[hoveredIndex].timestamp);
    }
    return formatPeriodLabel(selectedPeriod);
  }, [
    hoveredIndex,
    pointsWithCoords,
    selectedPeriod,
    formatDate,
    formatPeriodLabel,
  ]);

  // Ключ для анимации NumberFlow
  const numberFlowKey = useMemo(() => {
    if (hoveredIndex !== null && pointsWithCoords[hoveredIndex]) {
      return `${selectedPeriod}-${hoveredIndex}-${pointsWithCoords[hoveredIndex].value}`;
    }
    return `${selectedPeriod}-default-${initialProfit}`;
  }, [hoveredIndex, pointsWithCoords, selectedPeriod, initialProfit]);

  // Обработчик движения мыши
  const handleMouseMove = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      if (!svgRef.current || pointsWithCoords.length === 0 || isPending) return;

      const rect = svgRef.current.getBoundingClientRect();
      const mouseX = ((e.clientX - rect.left) / rect.width) * 100;

      // Находим ближайшую точку по X
      let closestIndex = 0;
      let minDiff = Math.abs(pointsWithCoords[0].x - mouseX);

      for (let i = 1; i < pointsWithCoords.length; i++) {
        const diff = Math.abs(pointsWithCoords[i].x - mouseX);
        if (diff < minDiff) {
          minDiff = diff;
          closestIndex = i;
        }
      }

      // Обновляем только если изменился индекс
      setHoveredIndex((prev) => (prev !== closestIndex ? closestIndex : prev));
    },
    [pointsWithCoords, isPending],
  );

  const handleMouseLeave = useCallback(() => {
    setHoveredIndex(null);
  }, []);

  // X позиция для линии
  const hoveredX = useMemo(() => {
    if (
      hoveredIndex === null ||
      hoveredIndex < 0 ||
      hoveredIndex >= pointsWithCoords.length
    ) {
      return null;
    }
    return pointsWithCoords[hoveredIndex]?.x ?? null;
  }, [hoveredIndex, pointsWithCoords]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.1 }}
      style={{
        width: "639px",
        height: "236px",
        borderRadius: "8px",
        padding: "20px",
        border: "1px solid #e5e7eb",
      }}
      className="bg-white shadow-lg flex flex-col"
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <svg
            className="w-4 h-4 text-green-500"
            fill="currentColor"
            viewBox="0 0 20 20"
          >
            <path
              fillRule="evenodd"
              d="M12 7a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0V8.414l-4.293 4.293a1 1 0 01-1.414 0L8 10.414l-4.293 4.293a1 1 0 01-1.414-1.414l5-5a1 1 0 011.414 0L11 10.586 14.586 7H12z"
              clipRule="evenodd"
            />
          </svg>
          <span className="text-sm font-medium text-gray-700">Profit/Loss</span>
          <svg
            className="w-4 h-4 text-gray-300"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
        </div>
        <div className="text-xs text-gray-400">{displayLabel}</div>
      </div>

      {/* Period Buttons */}
      <div className="flex justify-end gap-1 mb-2">
        {periods.map((period) => (
          <motion.button
            key={period}
            whileHover={{ scale: 1.1, y: -2 }}
            whileTap={{ scale: 0.95 }}
            whileDrag={{ scale: 1.2, rotate: 5 }}
            drag
            dragConstraints={{ left: -10, right: 10, top: -10, bottom: 10 }}
            onClick={() => handlePeriodChange(period)}
            disabled={isPending}
            className={`px-2 py-0.5 text-xs font-medium rounded transition-all ${
              selectedPeriod === period
                ? "bg-orange-50 text-orange-500"
                : "text-gray-400 hover:text-gray-600"
            } ${isPending ? "opacity-50 cursor-not-allowed" : ""}`}
          >
            {period}
          </motion.button>
        ))}
      </div>

      {/* Profit Value */}
      <div className="mb-1">
        <AnimatePresence mode="wait">
          <motion.div
            key={numberFlowKey} // Уникальный ключ!
            initial={{ opacity: 0, y: -5 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 5 }}
            transition={{ duration: 0.1 }}
            className="text-4xl font-bold text-gray-900 tracking-tight"
          >
            +$
            <NumberFlow
              value={displayValue}
              format={{ minimumFractionDigits: 2, maximumFractionDigits: 2 }}
            />
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Label */}
      <div className="text-xs text-gray-400 mb-2">{displayLabel}</div>

      {/* Chart */}
      <div className="relative flex-1 min-h-0">
        <AnimatePresence mode="wait">
          <motion.svg
            key={selectedPeriod} // Пересоздаём при смене периода
            ref={svgRef}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            className="w-full h-full overflow-visible cursor-crosshair"
            onMouseMove={handleMouseMove}
            onMouseLeave={handleMouseLeave}
          >
            <defs>
              <linearGradient
                id="chartGradient"
                x1="0%"
                y1="0%"
                x2="0%"
                y2="100%"
              >
                <stop offset="0%" stopColor="rgba(255, 107, 53, 0.15)" />
                <stop offset="100%" stopColor="rgba(255, 107, 53, 0)" />
              </linearGradient>
            </defs>

            {areaPath && (
              <motion.path
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.4 }}
                d={areaPath}
                fill="url(#chartGradient)"
              />
            )}

            {svgPath && (
              <motion.path
                initial={{ pathLength: 0 }}
                animate={{ pathLength: 1 }}
                transition={{ duration: 0.8, ease: "easeOut" }}
                d={svgPath}
                fill="none"
                stroke="#ff6b35"
                strokeWidth="1.5"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
              />
            )}

            {/* Hover line */}
            <AnimatePresence>
              {hoveredX !== null && (
                <motion.line
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 0.4 }}
                  exit={{ opacity: 0 }}
                  x1={hoveredX}
                  y1="0"
                  x2={hoveredX}
                  y2="100"
                  stroke="#ff6b35"
                  strokeWidth="0.8"
                  strokeDasharray="3,3"
                  vectorEffect="non-scaling-stroke"
                />
              )}
            </AnimatePresence>
          </motion.svg>
        </AnimatePresence>

        {isPending && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="absolute inset-0 bg-white/80 flex items-center justify-center"
          >
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
              className="w-4 h-4 border-2 border-orange-400 border-t-transparent rounded-full"
            />
          </motion.div>
        )}
      </div>
    </motion.div>
  );
}
