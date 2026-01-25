"use client";

import React from "react";
import { motion } from "framer-motion";
import NumberFlow from "@number-flow/react";

interface WalletCardProps {
  balance: number;
  profit: number;
  profitPercent: number;
  portfolioValue: number;
  usdcValue: number;
  onDeposit: () => void;
  onWithdraw: () => void;
}

export default function WalletCard({
  balance,
  profit,
  profitPercent,
  portfolioValue,
  usdcValue,
  onDeposit,
  onWithdraw,
}: WalletCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
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
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-3">
          <motion.div
            className="w-10 h-10 bg-[#ff6b35] rounded-full flex items-center justify-center"
            whileHover={{ scale: 1.1, rotate: 10 }}
            whileTap={{ scale: 0.95 }}
            whileDrag={{ scale: 1.2 }}
            drag
            dragConstraints={{ left: 0, right: 0, top: 0, bottom: 0 }}
          >
            <svg
              className="w-5 h-5 text-white"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z"
              />
            </svg>
          </motion.div>
          <div>
            <div className="flex items-center gap-1">
              <span className="text-sm font-semibold text-gray-900">
                My Wallet
              </span>
              <svg
                className="w-3.5 h-3.5 text-gray-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                />
              </svg>
            </div>
            <span className="text-xs text-gray-400">Joined Nov 2025</span>
          </div>
        </div>

        <div className="flex items-start gap-6 text-xs">
          <div className="text-right">
            <div className="text-gray-400 mb-0.5">Portfolio ( Net USDC )</div>
            <div className="font-semibold text-gray-900">
              $
              <NumberFlow
                value={portfolioValue}
                format={{ minimumFractionDigits: 2, maximumFractionDigits: 2 }}
              />
            </div>
          </div>
          <div className="text-right">
            <div className="text-gray-400 mb-0.5 flex items-center gap-1 justify-end">
              <svg
                className="w-3 h-3 text-green-500"
                fill="currentColor"
                viewBox="0 0 20 20"
              >
                <path
                  fillRule="evenodd"
                  d="M12 7a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0V8.414l-4.293 4.293a1 1 0 01-1.414 0L8 10.414l-4.293 4.293a1 1 0 01-1.414-1.414l5-5a1 1 0 011.414 0L11 10.586 14.586 7H12z"
                  clipRule="evenodd"
                />
              </svg>
              USDC » Portfolio
            </div>
            <div className="font-semibold text-gray-900">
              $
              <NumberFlow
                value={usdcValue}
                format={{ minimumFractionDigits: 2, maximumFractionDigits: 2 }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Main Balance */}
      <div className="mb-1">
        <div className="text-4xl font-bold text-gray-900 tracking-tight">
          <NumberFlow
            value={balance}
            format={{ minimumFractionDigits: 2, maximumFractionDigits: 2 }}
          />
          <span className="text-2xl font-medium text-gray-500 ml-2">USDC</span>
        </div>
      </div>

      {/* Profit indicator - mb-auto чтобы прижать кнопки вниз */}
      <div className="flex items-center gap-2 mb-3">
        <span className="text-sm font-medium text-green-500">
          +$
          <NumberFlow
            value={profit}
            format={{ minimumFractionDigits: 2, maximumFractionDigits: 2 }}
          />
        </span>
        <span className="text-green-500 text-sm">▲</span>
        <span className="text-sm font-medium text-green-500">
          <NumberFlow
            value={profitPercent}
            format={{ minimumFractionDigits: 1, maximumFractionDigits: 1 }}
          />
          %
        </span>
        <span className="text-sm text-gray-400">Today</span>
      </div>

      {/* Action Buttons - mt-auto убрано, кнопки выше */}
      <div className="flex gap-3 mt-auto">
        <motion.button
          whileHover={{
            scale: 1.02,
            boxShadow: "0 8px 25px rgba(255, 107, 53, 0.3)",
          }}
          whileTap={{ scale: 0.98 }}
          whileDrag={{ scale: 1.05 }}
          drag
          dragConstraints={{ left: -5, right: 5, top: -5, bottom: 5 }}
          onClick={onDeposit}
          className="flex-1 bg-[#ff5722] hover:bg-[#f4511e] text-white rounded-xl py-3 px-4 font-semibold text-sm flex items-center justify-center gap-2 transition-all"
        >
          <svg
            className="w-4 h-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M19 14l-7 7m0 0l-7-7m7 7V3"
            />
          </svg>
          Deposit
        </motion.button>

        <motion.button
          whileHover={{ scale: 1.02, backgroundColor: "#f9fafb" }}
          whileTap={{ scale: 0.98 }}
          whileDrag={{ scale: 1.05 }}
          drag
          dragConstraints={{ left: -5, right: 5, top: -5, bottom: 5 }}
          onClick={onWithdraw}
          className="flex-1 bg-gray-50 hover:bg-gray-100 border border-gray-200 text-gray-700 rounded-xl py-3 px-4 font-semibold text-sm flex items-center justify-center gap-2 transition-all"
        >
          <svg
            className="w-4 h-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M5 10l7-7m0 0l7 7m-7-7v18"
            />
          </svg>
          Withdraw
        </motion.button>
      </div>
    </motion.div>
  );
}
