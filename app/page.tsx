import React, { Suspense } from "react";
import { getWalletBalance, getProfitLoss } from "./actions";
import DashboardClient from "@/components/DashboardClient";

async function getDashboardData() {
  const publicKey = process.env.NEXT_PUBLIC_WALLET_ADDRESS;

  if (!publicKey || publicKey.includes("your")) {
    throw new Error("NEXT_PUBLIC_WALLET_ADDRESS not configured in .env.local");
  }

  const [walletData, profitData] = await Promise.all([
    getWalletBalance(publicKey),
    getProfitLoss(publicKey),
  ]);

  return {
    balance: parseFloat(walletData.tokenBalance),
    profit: profitData.profit,
    profitPercent: profitData.profitPercent,
    portfolioValue: parseFloat(walletData.portfolioValue),
    usdcValue: parseFloat(walletData.tokenBalance),
    chartData: profitData.chartData,
    publicKey,
  };
}

function LoadingSkeleton() {
  return (
    <div className="min-h-screen bg-[#c2410c] flex items-center justify-center">
      <div className="flex flex-col md:flex-row gap-[19px]">
        <div
          className="bg-white shadow-lg animate-pulse"
          style={{ width: "639px", height: "236px", borderRadius: "8px" }}
        />
        <div
          className="bg-white shadow-lg animate-pulse"
          style={{ width: "639px", height: "236px", borderRadius: "8px" }}
        />
      </div>
    </div>
  );
}

export default async function HomePage() {
  let data;

  try {
    data = await getDashboardData();
  } catch (error: any) {
    return (
      <div className="min-h-screen bg-[#c2410c] flex items-center justify-center p-8">
        <div className="bg-white rounded-lg p-8 max-w-md text-center">
          <h1 className="text-xl font-bold text-red-600 mb-4">
            Configuration Error
          </h1>
          <p className="text-gray-600 mb-4">{error.message}</p>
          <p className="text-sm text-gray-500">
            Please configure your .env.local file with valid API keys.
          </p>
        </div>
      </div>
    );
  }

  return (
    <Suspense fallback={<LoadingSkeleton />}>
      <DashboardClient {...data} />
    </Suspense>
  );
}
