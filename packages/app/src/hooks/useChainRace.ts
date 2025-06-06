"use client";

import { useState, useEffect, useCallback } from "react";
import {
  createPublicClient,
  createWalletClient,
  http,
  type Hex,
  type Chain,
  TransactionReceipt,
} from "viem";
import { allChains, type AnyChainConfig } from "@/chain/networks";
import { useEmbeddedWallet } from "./useEmbeddedWallet";
import { useSolanaEmbeddedWallet } from "./useSolanaEmbeddedWallet";
import { createSyncPublicClient, syncTransport } from "rise-shred-client";
import {
  Connection,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import type { SolanaChainConfig } from "@/solana/config";
import { getGeo } from "@/lib/geo";
import { saveRaceResults } from "@/lib/api";

export type ChainRaceStatus =
  | "idle"
  | "funding"
  | "ready"
  | "racing"
  | "finished";

export interface ChainBalance {
  chainId: number | string; // Support both EVM (number) and Solana (string) chain IDs
  balance: bigint;
  hasBalance: boolean;
  error?: string;
}

export interface RaceResult {
  chainId: number | string; // Support both EVM (number) and Solana (string) chain IDs
  name: string;
  color: string;
  logo?: string; // Path to the chain logo
  status: "pending" | "racing" | "success" | "error";
  txHash?: Hex; // EVM transaction hash
  signature?: string; // Solana transaction signature
  error?: string;
  position?: number;
  txCompleted: number; // Count of completed transactions
  txTotal: number; // Total transactions required
  txLatencies: number[]; // Array of individual transaction latencies in ms
  averageLatency?: number; // Average transaction latency
  totalLatency?: number; // Total latency of all transactions combined
}

export type TransactionCount = 1 | 5 | 10 | 20;

export interface RaceSessionPayload {
  title: string;
  walletAddress: string;
  transactionCount: number;
  status: "completed";
  city?: string;
  region?: string;
  country?: string;
  results: ChainResultPayload[];
}

export interface ChainResultPayload {
  chainId: number;
  chainName: string;
  txLatencies: number[]; // raw per-tx times
  averageLatency: number;
  totalLatency: number;
  status: string;
  position?: number;
}

// Constants for localStorage keys
const LOCAL_STORAGE_SELECTED_CHAINS = "horse-race-selected-chains";
const LOCAL_STORAGE_TX_COUNT = "horse-race-tx-count";
const LOCAL_STORAGE_WAIT_FOR_RECEIPTS = "horse-race-wait-for-receipts";

// Helper functions to distinguish chain types
function isEvmChain(chain: AnyChainConfig): chain is Chain & {
  testnet: boolean;
  color: string;
  logo: string;
  faucetUrl?: string;
} {
  return "id" in chain && typeof chain.id === "number";
}

function isSolanaChain(chain: AnyChainConfig): chain is SolanaChainConfig {
  return "cluster" in chain;
}

// Helper function to get fallback RPC endpoints for Solana
function getSolanaFallbackEndpoints(chain: SolanaChainConfig): string[] {
  const fallbackEndpoints = [
    chain.endpoint,
    // Fallback RPC endpoints for Solana
    ...(chain.id === "solana-mainnet"
      ? [
          "https://api.mainnet-beta.solana.com",
          "https://solana-api.projectserum.com",
          "https://rpc.ankr.com/solana",
        ]
      : chain.id === "solana-devnet"
      ? ["https://api.devnet.solana.com"]
      : ["https://api.testnet.solana.com"]),
  ];
  return fallbackEndpoints;
}

export function useChainRace() {
  const { account, privateKey, isReady, resetWallet } = useEmbeddedWallet();
  const {
    publicKey: solanaPublicKey,
    keypair: solanaKeypair,
    isReady: solanaReady,
  } = useSolanaEmbeddedWallet();
  const [status, setStatus] = useState<ChainRaceStatus>("idle");
  const [balances, setBalances] = useState<ChainBalance[]>([]);
  const [results, setResults] = useState<RaceResult[]>([]);
  const [isLoadingBalances, setIsLoadingBalances] = useState(false);
  const [transactionCount, setTransactionCount] = useState<TransactionCount>(
    () => {
      // Load saved transaction count from localStorage if available
      // if (typeof window !== 'undefined') {
      //   const savedCount = localStorage.getItem(LOCAL_STORAGE_TX_COUNT);
      //   if (savedCount) {
      //     const count = parseInt(savedCount, 10) as TransactionCount;
      //     if ([1, 5, 10, 20].includes(count)) {
      //       return count;
      //     }
      //   }
      // }
      return 10;
    }
  );

  const [selectedChains, setSelectedChains] = useState<(number | string)[]>(
    () => {
      // Load saved chain selection from localStorage if available
      if (typeof window !== "undefined") {
        const savedChains = localStorage.getItem(LOCAL_STORAGE_SELECTED_CHAINS);
        if (savedChains) {
          try {
            const parsed = JSON.parse(savedChains) as (number | string)[];
            // Validate that all chains in the saved list are actually valid chains
            const validChainIds: (number | string)[] = allChains.map((chain) =>
              isEvmChain(chain) ? chain.id : chain.id
            );
            const validSavedChains = parsed.filter((id) =>
              validChainIds.includes(id)
            );

            if (validSavedChains.length > 0) {
              return validSavedChains;
            }
          } catch (e) {
            console.error("Failed to parse saved chain selection:", e);
          }
        }
      }
      // Default to all chains (EVM + Solana)
      return allChains.map((chain) =>
        isEvmChain(chain) ? chain.id : chain.id
      );
    }
  );

  const [waitForReceipts, setWaitForReceipts] = useState<boolean>(() => {
    // Load saved wait for receipts setting from localStorage if available
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem(LOCAL_STORAGE_WAIT_FOR_RECEIPTS);
      if (saved !== null) {
        return saved === "true";
      }
    }
    // Default to false (faster races)
    return false;
  });

  // Effect to save chain selection to localStorage when it changes
  useEffect(() => {
    if (typeof window !== "undefined" && selectedChains.length > 0) {
      localStorage.setItem(
        LOCAL_STORAGE_SELECTED_CHAINS,
        JSON.stringify(selectedChains)
      );
    }
  }, [selectedChains]);

  // Effect to save transaction count to localStorage when it changes
  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem(LOCAL_STORAGE_TX_COUNT, transactionCount.toString());
    }
  }, [transactionCount]);

  // Effect to save wait for receipts setting to localStorage when it changes
  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem(
        LOCAL_STORAGE_WAIT_FOR_RECEIPTS,
        waitForReceipts.toString()
      );
    }
  }, [waitForReceipts]);

  // Define checkBalances before using it in useEffect
  const checkBalances = useCallback(async () => {
    if (!account || !solanaReady || !solanaPublicKey) return;

    setIsLoadingBalances(true);

    try {
      // Check balances for all chains regardless of selection
      const activeChains = allChains;

      // Add a small delay to avoid overwhelming network requests on page load
      await new Promise((resolve) => setTimeout(resolve, 500));

      const balancePromises = activeChains.map(async (chain) => {
        // Function to attempt a balance check with retries
        const attemptBalanceCheck = async (
          retryCount = 0,
          maxRetries = 3
        ): Promise<{
          chainId: number | string;
          balance: bigint;
          hasBalance: boolean;
          error?: string;
        }> => {
          try {
            let balance: bigint;
            const chainId = isEvmChain(chain) ? chain.id : chain.id;

            if (isEvmChain(chain)) {
              // EVM chain balance check
              const client = createPublicClient({
                chain,
                transport: http(),
              });

              balance = await client.getBalance({ address: account.address });
              // Reduced balance threshold for testing (0.001 tokens instead of 0.01)
              const hasBalance = balance > BigInt(1e14);

              return {
                chainId,
                balance,
                hasBalance,
              };
            } else if (isSolanaChain(chain)) {
              // Solana chain balance check with fallback endpoints
              const fallbackEndpoints = getSolanaFallbackEndpoints(chain);

              let lastError;
              for (const endpoint of fallbackEndpoints) {
                try {
                  const connection = new Connection(endpoint, chain.commitment);
                  const lamports = await connection.getBalance(
                    solanaPublicKey,
                    chain.commitment
                  );

                  // Convert lamports to bigint for consistency with EVM
                  balance = BigInt(lamports);
                  // Minimum balance threshold: 0.001 SOL (1,000,000 lamports)
                  const hasBalance = balance > BigInt(1_000_000);

                  return {
                    chainId,
                    balance,
                    hasBalance,
                  };
                } catch (endpointError) {
                  console.warn(
                    `Solana RPC ${endpoint} failed for ${chain.id}:`,
                    endpointError
                  );
                  lastError = endpointError;
                  continue;
                }
              }

              // If all endpoints failed, throw the last error
              throw (
                lastError ||
                new Error(`All Solana RPC endpoints failed for ${chain.id}`)
              );
            } else {
              throw new Error(`Unsupported chain type: ${chainId}`);
            }
          } catch (error) {
            console.error(
              `Failed to get balance for chain ${
                isEvmChain(chain) ? chain.id : chain.id
              } (attempt ${retryCount + 1}/${maxRetries + 1}):`,
              error
            );

            // Retry logic
            if (retryCount < maxRetries) {
              // Exponential backoff: 1s, 2s, 4s, etc.
              const backoffTime = 1000 * Math.pow(2, retryCount);
              await new Promise((resolve) => setTimeout(resolve, backoffTime));
              return attemptBalanceCheck(retryCount + 1, maxRetries);
            }

            const errorMessage =
              error instanceof Error ? error.message : "Unknown error";
            return {
              chainId: isEvmChain(chain) ? chain.id : chain.id,
              balance: BigInt(0),
              hasBalance: false,
              error: errorMessage,
            };
          }
        };

        // Wrap in a timeout to ensure the promise resolves eventually
        const timeoutPromise = new Promise<{
          chainId: number | string;
          balance: bigint;
          hasBalance: boolean;
          error?: string;
        }>((_, reject) => {
          setTimeout(
            () => reject(new Error(`RPC request timed out for ${chain.name}`)),
            30000
          );
        });

        // Race the balance check with the timeout
        return Promise.race([attemptBalanceCheck(), timeoutPromise]).catch(
          (error) => {
            console.error(
              `Ultimate failure checking balance for ${chain.name}:`,
              error
            );
            return {
              chainId: isEvmChain(chain) ? chain.id : chain.id,
              balance: BigInt(0),
              hasBalance: false,
              error:
                error instanceof Error
                  ? `Request failed: ${error.message}`
                  : "Unknown error checking balance",
            };
          }
        );
      });

      const newBalances = await Promise.all(balancePromises);

      // Log any errors that occurred during balance checks
      newBalances.forEach((balance) => {
        if (balance.error) {
          const chain = allChains.find(
            (c) => (isEvmChain(c) ? c.id : c.id) === balance.chainId
          );
          console.warn(
            `Error checking balance for ${chain?.name || balance.chainId}: ${
              balance.error
            }`
          );
        }
      });

      // Don't update state if component unmounted during the operation
      if (!account) return;

      setBalances(newBalances);

      // Only consider selected chains for determining if all are funded
      const selectedBalances = newBalances.filter((b) =>
        selectedChains.includes(b.chainId)
      );

      // If all selected chains have balance, set status to ready
      const allSelectedFunded =
        selectedBalances.length > 0 &&
        selectedBalances.every((b) => b.hasBalance);

      // Only proceed with FUNDED chains
      const fundedChains = selectedBalances
        .filter((b) => b.hasBalance)
        .map((b) => b.chainId);

      // Only update status if not in racing or finished state
      if (status !== "racing" && status !== "finished") {
        if (allSelectedFunded && selectedBalances.length > 0) {
          setStatus("ready");
        } else if (fundedChains.length > 0) {
          // If at least one chain is funded, allow race to start with those chains
          setStatus("ready");
          // Update selected chains to only those that are funded
          setSelectedChains(fundedChains);
        } else {
          setStatus("funding");
        }
      }
    } catch (error) {
      console.error("Failed to check balances:", error);
    } finally {
      setIsLoadingBalances(false);
    }
  }, [account, solanaPublicKey, solanaReady, status, selectedChains]);

  // Effect to check balances automatically when wallet is ready
  useEffect(() => {
    if (
      isReady &&
      solanaReady &&
      account &&
      solanaPublicKey &&
      status !== "racing" &&
      status !== "finished"
    ) {
      // Add a small delay to ensure everything is fully initialized
      const timer = setTimeout(() => {
        checkBalances();
      }, 1000);

      return () => clearTimeout(timer);
    }
  }, [isReady, solanaReady, account, solanaPublicKey, status, checkBalances]);

  // Effect to save race results when race finishes
  useEffect(() => {
    const saveResults = async () => {
      if (status === "finished" && results.length > 0 && account) {
        try {
          const isDevelopment = process.env.NODE_ENV === "development";

          if (isDevelopment) {
            console.log(
              "🏁 [Chain Derby] Race finished! Preparing to save results..."
            );
            console.log("🔍 [Chain Derby] Results data:", results);
            console.log("👤 [Chain Derby] Account:", account?.address);
            console.log(
              "🔢 [Chain Derby] Transaction count:",
              transactionCount
            );
          }

          const geo = await getGeo();

          if (isDevelopment) {
            console.log("🌍 [Chain Derby] Geo location:", geo);
          }

          // Convert results to the API payload format
          const chainResults: ChainResultPayload[] = results.map((result) => ({
            chainId: typeof result.chainId === "string" ? 0 : result.chainId, // Convert Solana string IDs to 0 for now
            chainName: result.name,
            txLatencies: result.txLatencies,
            averageLatency: result.averageLatency || 0,
            totalLatency: result.totalLatency || 0,
            status: result.status,
            position: result.position,
          }));

          if (isDevelopment) {
            console.log(
              "⛓️ [Chain Derby] Processed chain results:",
              chainResults
            );
          }

          const payload: RaceSessionPayload = {
            title: `Chain Derby Race - ${new Date().toISOString()}`,
            walletAddress: account.address,
            transactionCount,
            status: "completed",
            city: geo.city,
            region: geo.region,
            country: geo.country,
            results: chainResults,
          };

          if (isDevelopment) {
            console.log("📋 [Chain Derby] Final payload prepared:", payload);
            console.log("🚀 [Chain Derby] Initiating API call...");
          }

          await saveRaceResults(payload);

          if (isDevelopment) {
            console.log("🎉 [Chain Derby] Race results saved successfully!");
          }
        } catch (error) {
          const isDevelopment = process.env.NODE_ENV === "development";

          if (isDevelopment) {
            console.error(
              "❌ [Chain Derby] Failed to save race results:",
              error
            );
          }
          // Silently handle API failures - don't impact user experience
        }
      }
    };

    // Don't await this - let it run in background without blocking
    saveResults();
  }, [status, results, account, transactionCount]);

  // Create a wallet client - defined at hook level to avoid ESLint warnings
  const createClient = (chain: Chain) => {
    if (!account) {
      throw new Error("Cannot create wallet client: account is null");
    }

    return createWalletClient({
      account,
      chain,
      transport: http(),
    });
  };

  // Start the race across selected chains
  const startRace = async () => {
    if (!account || !privateKey || !solanaKeypair || status !== "ready") return;

    setStatus("racing");

    // Filter chains based on selection (support both EVM and Solana)
    const activeChains = allChains.filter((chain) =>
      selectedChains.includes(isEvmChain(chain) ? chain.id : chain.id)
    );

    // Pre-fetch all chain data needed for transactions
    const chainData = new Map<
      number | string,
      {
        nonce: number;
        chainId: number | string;
        gasPrice?: bigint;
        feeData?: bigint;
        blockData?: unknown;
        signedTransactions?: (string | null)[]; // Store pre-signed transactions, which may be null
        connection?: Connection; // For Solana chains
      }
    >();

    try {
      // Fetch chain data in parallel for selected chains
      const chainDataPromises = activeChains.map(async (chain) => {
        const chainId = isEvmChain(chain) ? chain.id : chain.id;

        try {
          if (isEvmChain(chain)) {
            // EVM chain data fetching
            const client = createPublicClient({
              chain,
              transport: http(),
            });

            // Run all required queries in parallel
            const [nonce, feeData, blockData] = await Promise.all([
              // Get current nonce
              client.getTransactionCount({
                address: account.address,
              }),

              // Get current fee data and double it for better confirmation chances
              client
                .getGasPrice()
                .then((gasPrice) => {
                  const doubledGasPrice = gasPrice * BigInt(3);
                  return doubledGasPrice;
                })
                .catch(() => {
                  // Fallback gas prices based on known chain requirements
                  const fallbackGasPrice = BigInt(
                    chain.id === 10143
                      ? 60000000000 // Monad has higher gas requirements
                      : chain.id === 8453
                      ? 2000000000 // Base mainnet
                      : chain.id === 17180
                      ? 1500000000 // Sonic
                      : 1000000000 // Default fallback (1 gwei)
                  );
                  return fallbackGasPrice;
                }),

              // Get latest block to ensure we have chain state
              client.getBlock().catch(() => null),
            ]);

            // Create wallet client for transaction signing
            const walletClient = createClient(chain);

            // Pre-sign all transactions IN PARALLEL
            const signedTransactionPromises = Array.from(
              { length: transactionCount },
              async (_, txIndex) => {
                try {
                  // Use Sepolia-like parameters for Monad since it's finicky
                  const txParams = {
                    to: account.address,
                    value: BigInt(0),
                    gas: 21000n,
                    gasPrice: feeData,
                    nonce: nonce + txIndex,
                    chainId: chain.id,
                    data: "0x" as const, // Use const assertion for hex string
                  };

                  const signedTx = await walletClient.signTransaction(txParams);

                  if (!signedTx) {
                    throw new Error("Signing transaction returned null");
                  }

                  return signedTx;
                } catch (signError) {
                  console.error(
                    `Error signing tx #${txIndex} for ${chain.name}:`,
                    signError
                  );
                  return null;
                }
              }
            );

            const signedTransactions = await Promise.all(
              signedTransactionPromises
            );

            return {
              chainId,
              nonce,
              gasPrice: feeData,
              feeData,
              blockData,
              signedTransactions,
            };
          } else if (isSolanaChain(chain)) {
            // Solana chain data fetching - try fallback endpoints to find working RPC
            const fallbackEndpoints = getSolanaFallbackEndpoints(chain);

            let workingConnection = null;
            for (const endpoint of fallbackEndpoints) {
              try {
                const connection = new Connection(endpoint, chain.commitment);
                // Test the connection by getting latest blockhash
                await connection.getLatestBlockhash(chain.commitment);
                workingConnection = connection;
                console.log(`Using Solana RPC ${endpoint} for ${chain.id}`);
                break;
              } catch (endpointError) {
                console.warn(
                  `Solana RPC ${endpoint} failed for ${chain.id} during setup:`,
                  endpointError
                );
                continue;
              }
            }

            if (!workingConnection) {
              throw new Error(
                `All Solana RPC endpoints failed for ${chain.id} during setup`
              );
            }

            // Just store the working connection for later use
            return {
              chainId,
              nonce: 0, // Not applicable for Solana
              connection: workingConnection,
              signedTransactions: [], // Empty array - we'll create transactions fresh during racing
            };
          } else {
            throw new Error(`Unsupported chain type: ${chainId}`);
          }
        } catch (fetchError) {
          console.error(
            `Failed to get chain data for ${chain.name}:`,
            fetchError
          );

          if (isEvmChain(chain)) {
            // Use specific fallback gas prices based on chain
            const fallbackGasPrice = BigInt(
              chain.id === 10143
                ? 60000000000 // Monad has higher gas requirements
                : chain.id === 8453
                ? 2000000000 // Base mainnet
                : chain.id === 17180
                ? 1500000000 // Sonic
                : chain.id === 6342
                ? 3000000000 // MegaETH
                : 1000000000 // Default fallback (1 gwei)
            );

            return {
              chainId,
              nonce: 0,
              gasPrice: fallbackGasPrice,
              signedTransactions: [],
            };
          } else {
            // Solana fallback
            return {
              chainId,
              nonce: 0,
              signedTransactions: [],
            };
          }
        }
      });

      // Store fetched data in the Map
      const results = await Promise.all(chainDataPromises);
      results.forEach((data) => {
        chainData.set(data.chainId, data);
      });
    } catch (error) {
      console.error("Error prefetching chain data:", error);
    }

    // Reset results for active chains only
    const initialResults = activeChains.map((chain) => ({
      chainId: isEvmChain(chain) ? chain.id : chain.id,
      name: chain.name,
      color: chain.color,
      logo: chain.logo, // Add logo path from the chain config
      status: "pending" as const,
      txCompleted: 0,
      txTotal: transactionCount,
      txLatencies: [], // Empty array to store individual transaction latencies
    }));

    setResults(initialResults);

    // Create a single race start time for all chains
    const globalRaceStartTime = Date.now();

    // Run ALL chain operations in parallel - no forEach async antipattern
    const chainRacePromises = activeChains.map(async (chain) => {
      const chainId = isEvmChain(chain) ? chain.id : chain.id;

      try {
        // Update status to racing for this chain
        setResults((prev) =>
          prev.map((r) =>
            r.chainId === chainId ? { ...r, status: "racing" } : r
          )
        );

        if (isEvmChain(chain)) {
          // EVM chain transaction processing
          const publicClient =
            chain.id !== 11155931
              ? createPublicClient({
                  chain,
                  transport: http(),
                })
              : null;

          // Get pre-fetched chain data including pre-signed transactions
          const fallbackGasPrice = BigInt(
            chain.id === 10143
              ? 60000000000 // Monad has higher gas requirements
              : chain.id === 8453
              ? 2000000000 // Base mainnet
              : chain.id === 6342
              ? 3000000000 // MegaETH
              : chain.id === 17180
              ? 1500000000 // Sonic
              : 1000000000 // Default fallback (1 gwei)
          );

          const currentChainData = chainData.get(chainId) || {
            nonce: 0,
            gasPrice: fallbackGasPrice,
            signedTransactions: [],
          };

          if (chain.id === 11155931) {
            // For RISE testnet, use the sync client and send all transactions in parallel
            const RISESyncClient = createSyncPublicClient({
              chain,
              transport: syncTransport(chain.rpcUrls.default.http[0]),
            });

            // Send ALL RISE transactions in parallel
            const riseTransactionPromises = Array.from(
              { length: transactionCount },
              async (_, txIndex) => {
                try {
                  const txStartTime = Date.now();
                  const signedTransaction =
                    currentChainData.signedTransactions?.[txIndex];

                  if (
                    !signedTransaction ||
                    typeof signedTransaction !== "string"
                  ) {
                    throw new Error(
                      `Invalid transaction format for RISE tx #${txIndex}`
                    );
                  }

                  const receipt = await RISESyncClient.sendRawTransactionSync(
                    signedTransaction as `0x${string}`
                  );

                  if (!receipt || !receipt.transactionHash) {
                    throw new Error(
                      `RISE sync transaction sent but no receipt returned for tx #${txIndex}`
                    );
                  }

                  const txEndTime = Date.now();
                  const txLatency = txEndTime - txStartTime;

                  return {
                    txIndex,
                    txHash: receipt.transactionHash,
                    txLatency,
                    txEndTime,
                    success: true,
                  };
                } catch (error) {
                  console.error(`RISE tx #${txIndex} error:`, error);
                  return {
                    txIndex,
                    txLatency: 0,
                    txEndTime: Date.now(),
                    success: false,
                    error,
                  };
                }
              }
            );

            // Wait for all RISE transactions to complete
            const riseResults = await Promise.allSettled(
              riseTransactionPromises
            );

            let latestEndTime = globalRaceStartTime;
            const confirmedLatencies: number[] = [];
            let lastTxHash: Hex | undefined;

            // Process all RISE results
            riseResults.forEach((result) => {
              if (result.status === "fulfilled" && result.value.success) {
                const { txLatency, txEndTime, txHash } = result.value;
                confirmedLatencies.push(txLatency);
                latestEndTime = Math.max(latestEndTime, txEndTime);
                lastTxHash = txHash;
              }
            });

            // Update results once with all RISE transactions
            if (confirmedLatencies.length > 0) {
              setResults((prev) => {
                const updatedResults = prev.map((r) => {
                  if (r.chainId === chainId) {
                    const newLatencies = [
                      ...r.txLatencies,
                      ...confirmedLatencies,
                    ];
                    const txCompleted =
                      r.txCompleted + confirmedLatencies.length;
                    const allTxCompleted = txCompleted >= transactionCount;

                    const totalLatency = allTxCompleted
                      ? latestEndTime - globalRaceStartTime
                      : undefined;

                    const averageLatency =
                      newLatencies.length > 0
                        ? Math.round(
                            newLatencies.reduce((sum, val) => sum + val, 0) /
                              newLatencies.length
                          )
                        : undefined;

                    const newStatus:
                      | "pending"
                      | "racing"
                      | "success"
                      | "error" = allTxCompleted ? "success" : "racing";

                    return {
                      ...r,
                      txHash: lastTxHash,
                      txCompleted,
                      status: newStatus,
                      txLatencies: newLatencies,
                      averageLatency,
                      totalLatency,
                    };
                  }
                  return r;
                });

                // Update rankings for finished chains
                const finishedResults = updatedResults
                  .filter((r) => r.status === "success")
                  .sort(
                    (a, b) =>
                      (a.averageLatency || Infinity) -
                      (b.averageLatency || Infinity)
                  );

                finishedResults.forEach((result, idx) => {
                  const position = idx + 1;
                  updatedResults.forEach((r, i) => {
                    if (r.chainId === result.chainId) {
                      updatedResults[i] = { ...r, position };
                    }
                  });
                });

                return updatedResults;
              });
            }
          } else if (chain.id === 6342) {
            // For MegaETH testnet, send all transactions in parallel
            const megaethTransactionPromises = Array.from(
              { length: transactionCount },
              async (_, txIndex) => {
                try {
                  const txStartTime = Date.now();
                  const signedTransaction =
                    currentChainData.signedTransactions?.[txIndex];

                  if (
                    !signedTransaction ||
                    typeof signedTransaction !== "string"
                  ) {
                    throw new Error(
                      `Invalid transaction format for MegaETH tx #${txIndex}`
                    );
                  }

                  if (!signedTransaction.startsWith("0x")) {
                    throw new Error(
                      `Invalid transaction format for MegaETH tx #${txIndex}: ${typeof signedTransaction}`
                    );
                  }

                  const receipt = (await publicClient!.request({
                    // @ts-expect-error - MegaETH custom method not in standard types
                    method: "realtime_sendRawTransaction",
                    params: [signedTransaction as `0x${string}`],
                  })) as TransactionReceipt | null;

                  if (!receipt) {
                    throw new Error(
                      `MegaETH transaction sent but no hash returned for tx #${txIndex}`
                    );
                  }

                  const txEndTime = Date.now();
                  const txLatency = txEndTime - txStartTime;

                  return {
                    txIndex,
                    txHash: receipt.transactionHash as Hex,
                    txLatency,
                    txEndTime,
                    success: true,
                  };
                } catch (error) {
                  console.error(`MegaETH tx #${txIndex} error:`, error);
                  return {
                    txIndex,
                    txLatency: 0,
                    txEndTime: Date.now(),
                    success: false,
                    error,
                  };
                }
              }
            );

            // Wait for all MegaETH transactions to complete
            const megaethResults = await Promise.allSettled(
              megaethTransactionPromises
            );

            let latestEndTime = globalRaceStartTime;
            const confirmedLatencies: number[] = [];
            let lastTxHash: Hex | undefined;

            // Process all MegaETH results
            megaethResults.forEach((result) => {
              if (result.status === "fulfilled" && result.value.success) {
                const { txLatency, txEndTime, txHash } = result.value;
                confirmedLatencies.push(txLatency);
                latestEndTime = Math.max(latestEndTime, txEndTime);
                lastTxHash = txHash;
              }
            });

            // Update results once with all MegaETH transactions
            if (confirmedLatencies.length > 0) {
              setResults((prev) => {
                const updatedResults = prev.map((r) => {
                  if (r.chainId === chainId) {
                    const newLatencies = [
                      ...r.txLatencies,
                      ...confirmedLatencies,
                    ];
                    const txCompleted =
                      r.txCompleted + confirmedLatencies.length;
                    const allTxCompleted = txCompleted >= transactionCount;

                    const totalLatency = allTxCompleted
                      ? latestEndTime - globalRaceStartTime
                      : undefined;

                    const averageLatency =
                      newLatencies.length > 0
                        ? Math.round(
                            newLatencies.reduce((sum, val) => sum + val, 0) /
                              newLatencies.length
                          )
                        : undefined;

                    const newStatus:
                      | "pending"
                      | "racing"
                      | "success"
                      | "error" = allTxCompleted ? "success" : "racing";

                    return {
                      ...r,
                      txHash: lastTxHash,
                      txCompleted,
                      status: newStatus,
                      txLatencies: newLatencies,
                      averageLatency,
                      totalLatency,
                    };
                  }
                  return r;
                });

                // Update rankings for finished chains
                const finishedResults = updatedResults
                  .filter((r) => r.status === "success")
                  .sort(
                    (a, b) =>
                      (a.averageLatency || Infinity) -
                      (b.averageLatency || Infinity)
                  );

                finishedResults.forEach((result, idx) => {
                  const position = idx + 1;
                  updatedResults.forEach((r, i) => {
                    if (r.chainId === result.chainId) {
                      updatedResults[i] = { ...r, position };
                    }
                  });
                });

                return updatedResults;
              });
            }
          } else {
            // For other chains, send all transactions in parallel, then wait for confirmations in parallel

            // Phase 1: Send ALL transactions in parallel
            const sendTransactionPromises = Array.from(
              { length: transactionCount },
              async (_, txIndex) => {
                try {
                  const txStartTime = Date.now();
                  const signedTransaction =
                    currentChainData.signedTransactions?.[txIndex];

                  if (!signedTransaction) {
                    throw new Error(
                      `No transaction to send for ${chain.name} tx #${txIndex}`
                    );
                  }

                  if (
                    typeof signedTransaction !== "string" ||
                    !signedTransaction.startsWith("0x")
                  ) {
                    throw new Error(
                      `Invalid transaction format for ${
                        chain.name
                      } tx #${txIndex}: ${typeof signedTransaction}`
                    );
                  }

                  // Send the raw transaction
                  const txHash = await publicClient!.sendRawTransaction({
                    serializedTransaction: signedTransaction as `0x${string}`,
                  });

                  if (!txHash) {
                    throw new Error(
                      `Transaction sent but no hash returned for ${chain.name} tx #${txIndex}`
                    );
                  }

                  return {
                    txIndex,
                    txHash,
                    txStartTime,
                    success: true,
                  };
                } catch (error) {
                  console.error(
                    `Send error for ${chain.name} tx #${txIndex}:`,
                    error
                  );
                  return {
                    txIndex,
                    txHash: null,
                    txStartTime: Date.now(),
                    success: false,
                    error,
                  };
                }
              }
            );

            // Wait for all sends to complete
            const sendResults = await Promise.allSettled(
              sendTransactionPromises
            );

            const txHashesWithTiming: Array<{
              hash: Hex;
              startTime: number;
              txIndex: number;
            }> = [];

            // Collect successful sends
            sendResults.forEach((result) => {
              if (
                result.status === "fulfilled" &&
                result.value.success &&
                result.value.txHash
              ) {
                txHashesWithTiming.push({
                  hash: result.value.txHash,
                  startTime: result.value.txStartTime,
                  txIndex: result.value.txIndex,
                });
              }
            });

            // Update result with first transaction hash (but not yet confirmed)
            if (txHashesWithTiming.length > 0) {
              setResults((prev) =>
                prev.map((r) =>
                  r.chainId === chainId
                    ? { ...r, txHash: txHashesWithTiming[0].hash }
                    : r
                )
              );
            }

            // Phase 2: Wait for ALL confirmations in parallel
            if (txHashesWithTiming.length > 0) {
              const confirmationPromises = txHashesWithTiming.map(
                async ({ hash, startTime, txIndex }) => {
                  try {
                    if (waitForReceipts) {
                      // Wait for actual transaction receipt confirmation
                      await publicClient!.waitForTransactionReceipt({
                        pollingInterval: 33,
                        retryDelay: 0,
                        hash,
                        timeout: 60_000,
                      });
                    } else {
                      // Skip waiting for receipts - just use current time as "confirmation"
                      // This makes races much faster but less accurate
                    }

                    const txEndTime = Date.now();
                    const txLatency = txEndTime - startTime;

                    // Update results immediately for each confirmed transaction
                    setResults((prev) => {
                      const updatedResults = prev.map((r) => {
                        if (r.chainId === chainId) {
                          const newLatencies = [...r.txLatencies, txLatency];
                          const txCompleted = r.txCompleted + 1;
                          const allTxCompleted =
                            txCompleted >= transactionCount;

                          const totalLatency = allTxCompleted
                            ? txEndTime - globalRaceStartTime
                            : undefined;

                          const averageLatency =
                            newLatencies.length > 0
                              ? Math.round(
                                  newLatencies.reduce(
                                    (sum, val) => sum + val,
                                    0
                                  ) / newLatencies.length
                                )
                              : undefined;

                          const newStatus:
                            | "pending"
                            | "racing"
                            | "success"
                            | "error" = allTxCompleted ? "success" : "racing";

                          return {
                            ...r,
                            txCompleted,
                            status: newStatus,
                            txLatencies: newLatencies,
                            averageLatency,
                            totalLatency,
                          };
                        }
                        return r;
                      });

                      // Update rankings when chains complete
                      const finishedResults = updatedResults
                        .filter((r) => r.status === "success")
                        .sort(
                          (a, b) =>
                            (a.averageLatency || Infinity) -
                            (b.averageLatency || Infinity)
                        );

                      finishedResults.forEach((result, idx) => {
                        const position = idx + 1;
                        updatedResults.forEach((r, i) => {
                          if (r.chainId === result.chainId) {
                            updatedResults[i] = { ...r, position };
                          }
                        });
                      });

                      return updatedResults;
                    });

                    return { txIndex, txLatency, txEndTime, success: true };
                  } catch (error) {
                    console.error(
                      `Confirmation error for ${chain.name} tx #${txIndex}:`,
                      error
                    );
                    return {
                      txIndex,
                      txLatency: 0,
                      txEndTime: Date.now(),
                      success: false,
                      error,
                    };
                  }
                }
              );

              // Wait for all confirmations to complete (but results are already being updated above)
              await Promise.allSettled(confirmationPromises);
            }
          }
        } else if (isSolanaChain(chain)) {
          // Solana chain transaction processing - send ALL transactions in parallel
          const currentChainData = chainData.get(chainId);

          if (!currentChainData || !currentChainData.connection) {
            console.error(`No connection data for Solana chain ${chainId}`);
            return;
          }

          // Send ALL Solana transactions in parallel
          const solanaTransactionPromises = Array.from(
            { length: transactionCount },
            async (_, txIndex) => {
              try {
                const txStartTime = Date.now();

                // Create fresh transaction with unique nonce (using txIndex + timestamp for uniqueness)
                const transaction = new Transaction().add(
                  SystemProgram.transfer({
                    fromPubkey: solanaKeypair.publicKey,
                    toPubkey: solanaKeypair.publicKey,
                    lamports: txIndex, // Use different amounts to make transactions unique
                  })
                );

                const signature = await sendAndConfirmTransaction(
                  currentChainData.connection!,
                  transaction,
                  [solanaKeypair],
                  {
                    commitment: chain.commitment,
                    preflightCommitment: chain.commitment,
                  }
                );

                const txEndTime = Date.now();
                const txLatency = txEndTime - txStartTime;

                return {
                  txIndex,
                  signature,
                  txLatency,
                  txEndTime,
                  success: true,
                };
              } catch (error) {
                console.error(`Solana tx #${txIndex} error:`, error);
                return {
                  txIndex,
                  txLatency: 0,
                  txEndTime: Date.now(),
                  success: false,
                  error,
                };
              }
            }
          );

          // Wait for all Solana transactions to complete
          const solanaResults = await Promise.allSettled(
            solanaTransactionPromises
          );

          let latestEndTime = globalRaceStartTime;
          const confirmedLatencies: number[] = [];
          let lastSignature: string | undefined;

          // Process all Solana results
          solanaResults.forEach((result) => {
            if (result.status === "fulfilled" && result.value.success) {
              const { txLatency, txEndTime, signature } = result.value;
              confirmedLatencies.push(txLatency);
              latestEndTime = Math.max(latestEndTime, txEndTime);
              lastSignature = signature;
            }
          });

          // Update results once with all Solana transactions
          if (confirmedLatencies.length > 0) {
            setResults((prev) => {
              const updatedResults = prev.map((r) => {
                if (r.chainId === chainId) {
                  const newLatencies = [
                    ...r.txLatencies,
                    ...confirmedLatencies,
                  ];
                  const txCompleted = r.txCompleted + confirmedLatencies.length;
                  const allTxCompleted = txCompleted >= transactionCount;

                  const totalLatency = allTxCompleted
                    ? latestEndTime - globalRaceStartTime
                    : undefined;

                  const averageLatency =
                    newLatencies.length > 0
                      ? Math.round(
                          newLatencies.reduce((sum, val) => sum + val, 0) /
                            newLatencies.length
                        )
                      : undefined;

                  const newStatus: "pending" | "racing" | "success" | "error" =
                    allTxCompleted ? "success" : "racing";

                  return {
                    ...r,
                    signature: lastSignature,
                    txCompleted,
                    status: newStatus,
                    txLatencies: newLatencies,
                    averageLatency,
                    totalLatency,
                  };
                }
                return r;
              });

              // Update rankings when chains complete
              const finishedResults = updatedResults
                .filter((r) => r.status === "success")
                .sort(
                  (a, b) =>
                    (a.averageLatency || Infinity) -
                    (b.averageLatency || Infinity)
                );

              finishedResults.forEach((result, idx) => {
                const position = idx + 1;
                updatedResults.forEach((r, i) => {
                  if (r.chainId === result.chainId) {
                    updatedResults[i] = { ...r, position };
                  }
                });
              });

              return updatedResults;
            });
          }
        }
      } catch (error) {
        console.error(`Race initialization error for chain ${chainId}:`, error);
        setResults((prev) =>
          prev.map((r) =>
            r.chainId === chainId
              ? {
                  ...r,
                  status: "error" as const,
                  error:
                    error instanceof Error
                      ? error.message
                      : "Race initialization failed",
                }
              : r
          )
        );
      }
    });

    // Wait for ALL chains to complete their operations in parallel
    await Promise.allSettled(chainRacePromises);

    // Set status to finished once all chains are done
    setStatus("finished");
  };

  // Reset everything to prepare for a new race
  const resetRace = () => {
    setStatus("idle");
    setBalances([]);
    setResults([]);
  };

  // Start a new race with the same configuration (when already in finished state)
  const restartRace = () => {
    // Keep the balances but reset the results
    setStatus("ready");
    setResults([]);
  };

  // Skip a specific chain during the race
  const skipChain = (chainId: number | string) => {
    setResults((prev) =>
      prev.map((r) =>
        r.chainId === chainId
          ? {
              ...r,
              status: "success" as const, // Use const assertion to ensure correct type
              txCompleted: r.txTotal, // Mark all transactions as completed
              position: 999, // Put it at the end of the results
              error: "Skipped by user",
            }
          : r
      )
    );
  };

  return {
    status,
    balances,
    results,
    isLoadingBalances,
    checkBalances,
    startRace,
    resetRace,
    restartRace,
    skipChain,
    isReady,
    account,
    privateKey,
    transactionCount,
    setTransactionCount,
    resetWallet,
    selectedChains,
    setSelectedChains,
    waitForReceipts,
    setWaitForReceipts,
    // Solana wallet information
    solanaPublicKey,
    solanaKeypair,
    solanaReady,
  };
}
