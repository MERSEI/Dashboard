"use client";

import React, { useState } from "react";
import { motion } from "framer-motion";
import WalletCard from "./WalletCard";
import ProfitChart from "./ProfitChart";
import DepositModal from "./DepositModal";
import WithdrawModal from "./WithdrawModal";

interface DashboardClientProps {
  balance: number;
  profit: number;
  profitPercent: number;
  portfolioValue: number;
  usdcValue: number;
  chartData: Array<{ value: number; timestamp: number }>;
  publicKey: string;
}

export default function DashboardClient({
  balance,
  profit,
  profitPercent,
  portfolioValue,
  usdcValue,
  chartData,
  publicKey,
}: DashboardClientProps) {
  const [isDepositOpen, setIsDepositOpen] = useState(false);
  const [isWithdrawOpen, setIsWithdrawOpen] = useState(false);

  const handleRefresh = () => {
    window.location.reload();
  };

  return (
    <div className="min-h-screen bg-[#c2410c] flex items-center justify-center p-8">
      <div className="flex flex-col md:flex-row gap-[19px]">
        <motion.div
          initial={{ opacity: 0, x: -50 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ type: "spring", stiffness: 100 }}
        >
          <WalletCard
            balance={balance}
            profit={profit}
            profitPercent={profitPercent}
            portfolioValue={portfolioValue}
            usdcValue={usdcValue}
            onDeposit={() => setIsDepositOpen(true)}
            onWithdraw={() => setIsWithdrawOpen(true)}
          />
        </motion.div>

        <motion.div
          initial={{ opacity: 0, x: 50 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ type: "spring", stiffness: 100, delay: 0.1 }}
        >
          <ProfitChart
            initialData={chartData}
            publicKey={publicKey}
            initialProfit={profit}
          />
        </motion.div>
      </div>

      <DepositModal
        isOpen={isDepositOpen}
        onClose={() => setIsDepositOpen(false)}
        onSuccess={handleRefresh}
      />

      <WithdrawModal
        isOpen={isWithdrawOpen}
        onClose={() => setIsWithdrawOpen(false)}
        onSuccess={handleRefresh}
      />
    </div>
  );
}
