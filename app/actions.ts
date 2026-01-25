'use server'

import { ethers } from 'ethers'
import axios from 'axios'

const CACHE_DURATION = 60000 // 1 minute

interface CacheEntry<T> {
  data: T
  timestamp: number
}

const cache = new Map<string, CacheEntry<any>>()

// Логгер
const logger = {
  info: (msg: string, data?: any) => console.log(`[INFO] ${new Date().toISOString()} - ${msg}`, data || ''),
  error: (msg: string, error?: any) => console.error(`[ERROR] ${new Date().toISOString()} - ${msg}`, error),
  warn: (msg: string, data?: any) => console.warn(`[WARN] ${new Date().toISOString()} - ${msg}`, data || ''),
  debug: (msg: string, data?: any) => console.debug(`[DEBUG] ${new Date().toISOString()} - ${msg}`, data || ''),
}

function getCachedData<T>(key: string): T | null {
  const cached = cache.get(key)
  if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
    logger.debug(`Cache HIT for key: ${key}`)
    return cached.data
  }
  logger.debug(`Cache MISS for key: ${key}`)
  cache.delete(key)
  return null
}

function setCachedData<T>(key: string, data: T): void {
  logger.debug(`Cache SET for key: ${key}`)
  cache.set(key, { data, timestamp: Date.now() })
}

// ==================== TYPES ====================

export interface WalletData {
  balance: string
  portfolioValue: string
  profit: string
  profitPercent: number
  tokenBalance: string
  transactions: Transaction[]
  ethPrice: number
}

export interface Transaction {
  hash: string
  from: string
  to: string
  value: string
  timestamp: number
  type: 'deposit' | 'withdraw'
  tokenValue: string
  asset: 'ETH' | 'TOKEN'
}

export interface ChartDataPoint {
  value: number
  timestamp: number
}

export interface ProfitLossData {
  profit: number
  profitPercent: number
  chartData: ChartDataPoint[]
}

// ==================== HELPERS ====================

async function getEthPrice(): Promise<number> {
  const cached = getCachedData<number>('eth_price')
  if (cached) {
    logger.info('Using cached ETH price', { price: cached })
    return cached
  }

  logger.info('Fetching ETH price from CoinGecko...')
  
  try {
    const response = await axios.get('https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd', {
      timeout: 5000
    })
    const price = response.data.ethereum.usd
    logger.info('ETH price fetched successfully', { price })
    setCachedData('eth_price', price)
    return price
  } catch (error: any) {
    logger.error('Failed to fetch ETH price, using fallback', { 
      error: error.message,
      status: error.response?.status 
    })
    return 3000 // fallback
  }
}

function getTokenContract(providerOrSigner: ethers.JsonRpcProvider | ethers.Wallet) {
  const address = process.env.TOKEN_CONTRACT_ADDRESS
  logger.debug('Getting token contract', { address })

  if (!address || address.includes('your')) {
    logger.error('TOKEN_CONTRACT_ADDRESS not configured', { address })
    throw new Error('TOKEN_CONTRACT_ADDRESS not configured')
  }

  const abi = [
    'function balanceOf(address) view returns (uint256)',
    'function decimals() view returns (uint8)',
    'function transfer(address to, uint256 amount) returns (bool)',
    'function approve(address spender, uint256 amount) returns (bool)',
    'function symbol() view returns (string)'
  ]

  return new ethers.Contract(address, abi, providerOrSigner)
}

// ==================== MAIN FUNCTIONS ====================

export async function getWalletBalance(publicKey: string): Promise<WalletData> {
  const cacheKey = `balance_${publicKey}_${process.env.NEXT_PUBLIC_CHAIN_ID}`
  logger.info('getWalletBalance called', { publicKey, cacheKey })

  const cached = getCachedData<WalletData>(cacheKey)
  if (cached) {
    logger.info('Returning cached wallet data')
    return cached
  }

  // Validate address
  if (!publicKey || !publicKey.startsWith('0x') || publicKey.length !== 42) {
    logger.error('Invalid Ethereum address', { publicKey, length: publicKey?.length })
    throw new Error('Invalid Ethereum address')
  }

  // Check RPC
  if (!process.env.RPC_URL || process.env.RPC_URL.includes('your')) {
    logger.error('RPC_URL not configured')
    throw new Error('RPC_URL not configured in .env.local')
  }

  logger.info('Connecting to RPC', { rpcUrl: process.env.RPC_URL?.replace(/\/v2\/.*/, '/v2/***') })

  try {
    const provider = new ethers.JsonRpcProvider(process.env.RPC_URL)
    
    // Test connection
    const network = await provider.getNetwork()
    logger.info('Connected to network', { 
      chainId: network.chainId.toString(),
      name: network.name 
    })

    // Get ETH balance
    logger.debug('Fetching ETH balance...')
    const ethBalance = await provider.getBalance(publicKey)
    const ethBalanceFormatted = ethers.formatEther(ethBalance)
    logger.info('ETH balance fetched', { balance: ethBalanceFormatted })

    // Get token balance
    let tokenBalance = '0'
    let tokenDecimals = 6
    let tokenSymbol = 'USDC'
    
    try {
      logger.debug('Fetching token balance...')
      const tokenContract = getTokenContract(provider)
      const [balance, decimals, symbol] = await Promise.all([
        tokenContract.balanceOf(publicKey),
        tokenContract.decimals(),
        tokenContract.symbol()
      ])
      tokenBalance = ethers.formatUnits(balance, decimals)
      tokenDecimals = decimals
      tokenSymbol = symbol
      logger.info('Token balance fetched', { 
        balance: tokenBalance, 
        symbol: tokenSymbol,
        decimals: tokenDecimals 
      })
    } catch (e: any) {
      logger.warn('Token balance fetch failed', { error: e.message })
    }

    // Get ETH price
    const ethPrice = await getEthPrice()

    // Calculate portfolio value
    const ethValueUsd = parseFloat(ethBalanceFormatted) * ethPrice
    const tokenValueUsd = parseFloat(tokenBalance)
    const portfolioValue = (ethValueUsd + tokenValueUsd).toFixed(2)
    
    logger.info('Portfolio value calculated', { 
      ethValue: ethValueUsd.toFixed(2),
      tokenValue: tokenValueUsd.toFixed(2),
      total: portfolioValue 
    })

    // Get transaction history
    logger.debug('Fetching transaction history...')
    const transactions = await getTransactionHistory(publicKey, tokenDecimals)
    logger.info('Transactions fetched', { count: transactions.length })

    // Calculate profit/loss
    const { profit, profitPercent } = calculateTokenProfitLoss(
      transactions, 
      tokenBalance,
      publicKey
    )
    logger.info('Profit/loss calculated', { profit, profitPercent })

    const data: WalletData = {
      balance: ethBalanceFormatted,
      portfolioValue,
      profit: profit.toFixed(2),
      profitPercent,
      tokenBalance,
      transactions,
      ethPrice
    }

    setCachedData(cacheKey, data)
    logger.info('Wallet data cached and returned')
    return data

  } catch (error: any) {
    logger.error('Error in getWalletBalance', { 
      error: error.message,
      code: error.code,
      stack: error.stack 
    })
    throw new Error(`Failed to fetch wallet data: ${error.message}`)
  }
}

function calculateTokenProfitLoss(
  transactions: Transaction[],
  currentTokenBalance: string,
  publicKey: string
): { profit: number; profitPercent: number } {
  logger.debug('Calculating token profit/loss...')
  
  const tokenTxs = transactions.filter(tx => tx.asset === 'TOKEN')
  logger.debug('Token transactions filtered', { count: tokenTxs.length })
  
  if (tokenTxs.length === 0) {
    logger.warn('No token transactions found')
    return { profit: 0, profitPercent: 0 }
  }

  let totalIn = 0
  let totalOut = 0

  for (const tx of tokenTxs) {
    const value = parseFloat(tx.tokenValue) || 0
    if (tx.to.toLowerCase() === publicKey.toLowerCase()) {
      totalIn += value
    } else {
      totalOut += value
    }
  }

  const current = parseFloat(currentTokenBalance)
  const invested = totalIn - totalOut
  
  logger.debug('Profit calculation', { totalIn, totalOut, invested, current })

  if (invested <= 0) {
    return { 
      profit: current, 
      profitPercent: invested < 0 ? 100 : 0 
    }
  }

  const profit = current - invested
  const profitPercent = (profit / invested) * 100

  return { profit, profitPercent }
}

export async function getTransactionHistory(
  publicKey: string, 
  tokenDecimals: number = 6
): Promise<Transaction[]> {
  const cacheKey = `tx_${publicKey}_${process.env.NEXT_PUBLIC_CHAIN_ID}`
  logger.info('getTransactionHistory called', { publicKey, cacheKey })

  const cached = getCachedData<Transaction[]>(cacheKey)
  if (cached) {
    logger.info('Returning cached transactions')
    return cached
  }

  if (!process.env.ETHERSCAN_API_KEY || process.env.ETHERSCAN_API_KEY.includes('your')) {
    logger.error('ETHERSCAN_API_KEY not configured')
    return []
  }

  try {
    const network = process.env.NEXT_PUBLIC_CHAIN_ID === '5' ? 'goerli' : 'api'
    const baseUrl = network === 'goerli' 
      ? 'https://api-goerli.etherscan.io' 
      : 'https://api.etherscan.io'

    logger.info('Fetching from Etherscan', { network, baseUrl })

    const [txResponse, tokenTxResponse] = await Promise.all([
      axios.get(`${baseUrl}/api`, {
        params: {
          module: 'account',
          action: 'txlist',
          address: publicKey,
          startblock: 0,
          endblock: 99999999,
          sort: 'desc',
          apikey: process.env.ETHERSCAN_API_KEY
        },
        timeout: 10000
      }),
      axios.get(`${baseUrl}/api`, {
        params: {
          module: 'account',
          action: 'tokentx',
          address: publicKey,
          contractaddress: process.env.TOKEN_CONTRACT_ADDRESS,
          startblock: 0,
          endblock: 99999999,
          sort: 'desc',
          apikey: process.env.ETHERSCAN_API_KEY
        },
        timeout: 10000
      })
    ])

    logger.debug('Etherscan responses received', {
      ethTxStatus: txResponse.data.status,
      tokenTxStatus: tokenTxResponse.data.status,
      ethTxCount: txResponse.data.result?.length,
      tokenTxCount: tokenTxResponse.data.result?.length
    })

    const transactions: Transaction[] = []

    // ETH transactions
    if (txResponse.data.status === '1' && Array.isArray(txResponse.data.result)) {
      transactions.push(...txResponse.data.result.slice(0, 10).map((tx: any) => ({
        hash: tx.hash,
        from: tx.from,
        to: tx.to,
        value: ethers.formatEther(tx.value),
        timestamp: parseInt(tx.timeStamp) * 1000,
        type: tx.to.toLowerCase() === publicKey.toLowerCase() ? 'deposit' : 'withdraw',
        tokenValue: '0',
        asset: 'ETH' as const
      })))
      logger.info('ETH transactions processed', { count: Math.min(txResponse.data.result.length, 10) })
    } else {
      logger.warn('No ETH transactions or error', { message: txResponse.data.message })
    }

    // Token transactions
    if (tokenTxResponse.data.status === '1' && Array.isArray(tokenTxResponse.data.result)) {
      const tokenTxs = tokenTxResponse.data.result.slice(0, 20).map((tx: any) => ({
        hash: tx.hash,
        from: tx.from,
        to: tx.to,
        value: '0',
        timestamp: parseInt(tx.timeStamp) * 1000,
        type: tx.to.toLowerCase() === publicKey.toLowerCase() ? 'deposit' : 'withdraw',
        tokenValue: ethers.formatUnits(tx.value, tx.tokenDecimal || tokenDecimals),
        asset: 'TOKEN' as const
      }))
      transactions.push(...tokenTxs)
      logger.info('Token transactions processed', { count: Math.min(tokenTxResponse.data.result.length, 20) })
    } else {
      logger.warn('No token transactions or error', { message: tokenTxResponse.data.message })
    }

    transactions.sort((a, b) => b.timestamp - a.timestamp)

    setCachedData(cacheKey, transactions.slice(0, 30))
    logger.info('Transactions cached and returned', { totalCount: transactions.length })
    return transactions.slice(0, 30)

  } catch (error: any) {
    logger.error('Error fetching transactions', {
      error: error.message,
      response: error.response?.data,
      status: error.response?.status
    })
    return []
  }
}

export async function getChartData(
  publicKey: string,
  period: '1H' | '6H' | '1D' | '1W' | '1M' | 'All'
): Promise<ChartDataPoint[]> {
  const cacheKey = `chart_${publicKey}_${period}_${process.env.NEXT_PUBLIC_CHAIN_ID}`
  logger.info('getChartData called', { publicKey, period, cacheKey })

  const cached = getCachedData<ChartDataPoint[]>(cacheKey)
  if (cached) {
    logger.info('Returning cached chart data')
    return cached
  }

  try {
    const transactions = await getTransactionHistory(publicKey)
    const tokenTxs = transactions.filter(tx => tx.asset === 'TOKEN')
    
    logger.debug('Chart data generation', { 
      totalTxs: transactions.length,
      tokenTxs: tokenTxs.length 
    })
    
    if (tokenTxs.length === 0) {
      logger.warn('No token transactions for chart, generating empty')
      return generateEmptyChart(period)
    }

    const now = Date.now()
    const ranges: Record<string, number> = {
      '1H': 60 * 60 * 1000,
      '6H': 6 * 60 * 60 * 1000,
      '1D': 24 * 60 * 60 * 1000,
      '1W': 7 * 24 * 60 * 60 * 1000,
      '1M': 30 * 24 * 60 * 60 * 1000,
      'All': 365 * 24 * 60 * 60 * 1000
    }

    const timeRange = ranges[period] || ranges['1D']
    const intervals = period === '1H' ? 12 : period === '6H' ? 24 : period === '1D' ? 48 : 50
    
    logger.debug('Generating chart points', { intervals, timeRange })

    const points: ChartDataPoint[] = []
    
    for (let i = intervals; i >= 0; i--) {
      const timestamp = now - (i * timeRange / intervals)
      let runningBalance = 0
      
      for (const tx of tokenTxs) {
        if (tx.timestamp <= timestamp) {
          const value = parseFloat(tx.tokenValue) || 0
          if (tx.type === 'deposit') {
            runningBalance += value
          } else {
            runningBalance -= value
          }
        }
      }

      points.push({
        value: Math.max(0, runningBalance),
        timestamp
      })
    }

    setCachedData(cacheKey, points)
    logger.info('Chart data generated and cached', { pointsCount: points.length })
    return points

  } catch (error: any) {
    logger.error('Error generating chart data', { error: error.message })
    return generateEmptyChart(period)
  }
}

function generateEmptyChart(period: string): ChartDataPoint[] {
  logger.warn('Generating empty chart', { period })
  
  const now = Date.now()
  const ranges: Record<string, number> = {
    '1H': 60 * 60 * 1000,
    '6H': 6 * 60 * 60 * 1000,
    '1D': 24 * 60 * 60 * 1000,
    '1W': 7 * 24 * 60 * 60 * 1000,
    '1M': 30 * 24 * 60 * 60 * 1000,
    'All': 365 * 24 * 60 * 60 * 1000
  }
  
  const range = ranges[period] || ranges['1D']
  const count = period === '1H' ? 12 : period === '6H' ? 24 : period === '1D' ? 48 : 50
  
  return Array.from({ length: count }, (_, i) => ({
    value: 1000,
    timestamp: now - (count - i) * (range / count)
  }))
}

export async function depositFunds(amount: string): Promise<{ success: boolean; txHash?: string; error?: string }> {
  logger.info('depositFunds called', { amount })

  if (!process.env.WALLET_PRIVATE_KEY || process.env.WALLET_PRIVATE_KEY.includes('your')) {
    logger.error('WALLET_PRIVATE_KEY not configured')
    return { success: false, error: 'Wallet private key not configured' }
  }

  if (!process.env.NEXT_PUBLIC_WALLET_ADDRESS) {
    logger.error('NEXT_PUBLIC_WALLET_ADDRESS not configured')
    return { success: false, error: 'Wallet address not configured' }
  }

  try {
    logger.info('Initializing deposit transaction...')
    const provider = new ethers.JsonRpcProvider(process.env.RPC_URL)
    const wallet = new ethers.Wallet(process.env.WALLET_PRIVATE_KEY, provider)
    
    logger.debug('Wallet address', { address: wallet.address })
    
    const tokenContract = getTokenContract(wallet)
    
    const amountInUnits = ethers.parseUnits(amount, 6)
    logger.info('Sending deposit transaction', { 
      to: process.env.NEXT_PUBLIC_WALLET_ADDRESS,
      amount: amount,
      amountInUnits: amountInUnits.toString()
    })
    
    const tx = await tokenContract.transfer(process.env.NEXT_PUBLIC_WALLET_ADDRESS, amountInUnits)
    logger.info('Transaction sent', { hash: tx.hash })
    
    const receipt = await Promise.race([
      tx.wait(),
      new Promise<never>((_, reject) => 
        setTimeout(() => reject(new Error('Transaction timeout')), 60000)
      )
    ])

    logger.info('Transaction confirmed', { 
      status: receipt.status,
      blockNumber: receipt.blockNumber 
    })

    if (receipt.status !== 1) {
      throw new Error('Transaction failed on-chain')
    }

    cache.delete(`balance_${process.env.NEXT_PUBLIC_WALLET_ADDRESS}_${process.env.NEXT_PUBLIC_CHAIN_ID}`)
    logger.info('Cache cleared after deposit')
    
    return { success: true, txHash: tx.hash }

  } catch (error: any) {
    logger.error('Deposit failed', { 
      error: error.message,
      code: error.code,
      reason: error.reason 
    })
    return { success: false, error: error.message || 'Transaction failed' }
  }
}

export async function withdrawFunds(
  toAddress: string,
  amount: string
): Promise<{ success: boolean; txHash?: string; error?: string }> {
  logger.info('withdrawFunds called', { toAddress, amount })

  if (!toAddress || !toAddress.startsWith('0x') || toAddress.length !== 42) {
    logger.error('Invalid recipient address', { toAddress, length: toAddress?.length })
    return { success: false, error: 'Invalid recipient address' }
  }

  if (!process.env.WALLET_PRIVATE_KEY || process.env.WALLET_PRIVATE_KEY.includes('your')) {
    logger.error('WALLET_PRIVATE_KEY not configured')
    return { success: false, error: 'Wallet private key not configured' }
  }

  try {
    logger.info('Initializing withdraw transaction...')
    const provider = new ethers.JsonRpcProvider(process.env.RPC_URL)
    const wallet = new ethers.Wallet(process.env.WALLET_PRIVATE_KEY, provider)
    
    logger.debug('Wallet address', { address: wallet.address })
    
    const tokenContract = getTokenContract(wallet)
    
    logger.debug('Checking balance...')
    const balance = await tokenContract.balanceOf(wallet.address)
    const amountInUnits = ethers.parseUnits(amount, 6)
    
    logger.info('Balance check', { 
      balance: balance.toString(),
      requested: amountInUnits.toString() 
    })
    
    if (balance < amountInUnits) {
      logger.error('Insufficient balance')
      return { success: false, error: 'Insufficient balance' }
    }
    
    logger.info('Sending withdraw transaction', { to: toAddress, amount })
    const tx = await tokenContract.transfer(toAddress, amountInUnits)
    logger.info('Transaction sent', { hash: tx.hash })
    
    const receipt = await Promise.race([
      tx.wait(),
      new Promise<never>((_, reject) => 
        setTimeout(() => reject(new Error('Transaction timeout')), 60000)
      )
    ])

    logger.info('Transaction confirmed', { 
      status: receipt.status,
      blockNumber: receipt.blockNumber 
    })

    if (receipt.status !== 1) {
      throw new Error('Transaction failed on-chain')
    }

    cache.delete(`balance_${wallet.address}_${process.env.NEXT_PUBLIC_CHAIN_ID}`)
    cache.delete(`balance_${toAddress}_${process.env.NEXT_PUBLIC_CHAIN_ID}`)
    logger.info('Cache cleared after withdraw')
    
    return { success: true, txHash: tx.hash }

  } catch (error: any) {
    logger.error('Withdraw failed', { 
      error: error.message,
      code: error.code,
      reason: error.reason 
    })
    return { success: false, error: error.message || 'Transaction failed' }
  }
}

export async function getProfitLoss(publicKey: string): Promise<ProfitLossData> {
  const cacheKey = `profit_${publicKey}_${process.env.NEXT_PUBLIC_CHAIN_ID}`
  logger.info('getProfitLoss called', { publicKey, cacheKey })

  const cached = getCachedData<ProfitLossData>(cacheKey)
  if (cached) {
    logger.info('Returning cached profit/loss')
    return cached
  }

  try {
    logger.debug('Fetching wallet balance and chart data...')
    const walletData = await getWalletBalance(publicKey)
    const chartData = await getChartData(publicKey, '1D')

    const result: ProfitLossData = {
      profit: parseFloat(walletData.profit),
      profitPercent: walletData.profitPercent,
      chartData
    }

    setCachedData(cacheKey, result)
    logger.info('Profit/loss calculated and cached', result)
    return result

  } catch (error: any) {
    logger.error('Error in getProfitLoss', { error: error.message })
    throw new Error('Failed to calculate profit/loss')
  }
}