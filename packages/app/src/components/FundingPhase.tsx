"use client";

import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuCheckboxItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui";
import { allChains } from "@/chain/networks";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import { useChainRaceContext } from "@/providers/ChainRaceProvider";
import { useIsMobile } from "@/hooks/useMobile";
import {
  RefreshCw,
  CheckCircle,
  XCircle,
  Loader2,
  Droplets,
  Circle,
  ChevronDown,
  Settings,
} from "lucide-react";
import { formatEther } from "viem";
import Image from "next/image";
import { TransactionCount } from "@/hooks/useChainRace";

export function FundingPhase() {
  const {
    account,
    balances,
    checkBalances,
    isLoadingBalances,
    selectedChains,
    setSelectedChains,
    transactionCount,
    setTransactionCount,
    waitForReceipts,
    setWaitForReceipts,
    status,
  } = useChainRaceContext();
  const isMobile = useIsMobile();

  // Format balance for display - handle both EVM and Solana
  const formatBalance = (balance: bigint, chainId: number | string) => {
    if (typeof chainId === "string" && chainId.includes("solana")) {
      // Solana balance formatting (lamports to SOL)
      const solValue = Number(balance) / LAMPORTS_PER_SOL;
      if (isMobile) {
        if (solValue === 0) return "0.0";
        if (solValue < 0.0001) {
          return solValue.toExponential(2);
        }
        return solValue.toFixed(4).replace(/\.?0+$/, "");
      }
      // Desktop formatting
      if (solValue === 0) return "0.0";
      if (solValue < 0.000001) {
        return solValue.toExponential(3);
      }
      return solValue.toFixed(6).replace(/\.?0+$/, "");
    } else {
      // EVM balance formatting (wei to ETH)
      const etherValue = formatEther(balance);
      if (isMobile) {
        const num = parseFloat(etherValue);
        if (num === 0) return "0.0";
        if (num < 0.0001) {
          return num.toExponential(2);
        }
        return num.toFixed(4).replace(/\.?0+$/, "");
      }
      // Desktop formatting
      const num = parseFloat(etherValue);
      if (num === 0) return "0.0";
      if (num < 0.000001) {
        return num.toExponential(3);
      }
      return num.toFixed(6).replace(/\.?0+$/, "");
    }
  };

  const handleTxCountChange = (count: TransactionCount) => {
    setTransactionCount(count);
  };

  const toggleWaitForReceipts = () => {
    if (status === "racing") return; // Don't allow changes during a race
    setWaitForReceipts(!waitForReceipts);
  };

  if (!account) {
    return (
      <Card className="w-full">
        <CardContent className="pt-6">
          <div className="flex items-center justify-center h-24">
            <p>Loading wallet...</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="w-full pt-6 gap-3">
      <CardHeader className="flex flex-col sm:flex-row items-start sm:items-center sm:justify-between pb-0 mb-0 gap-4 sm:gap-0">
        <CardTitle className="mb-0">Race Control</CardTitle>

        {/* Controls Section */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2">
          {/* Settings Dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                disabled={status === "racing"}
                className="flex items-center gap-1"
              >
                <Settings size={16} />
                <span>Settings</span>
                <ChevronDown size={16} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Race Settings</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuCheckboxItem
                checked={waitForReceipts}
                onCheckedChange={toggleWaitForReceipts}
                disabled={status === "racing"}
              >
                Wait for Transaction Receipts
              </DropdownMenuCheckboxItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Transaction Count Selector */}
          {/* <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Transactions:</span>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={status === "racing"}
                  className="flex items-center gap-1 min-w-16"
                >
                  <span>{transactionCount}</span>
                  <ChevronDown size={16} />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => handleTxCountChange(1)}>
                  1 transaction
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleTxCountChange(5)}>
                  5 transactions
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleTxCountChange(10)}>
                  10 transactions
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleTxCountChange(20)}>
                  20 transactions
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div> */}

          {/* Refresh Button */}
          <Button
            variant="outline"
            onClick={checkBalances}
            disabled={isLoadingBalances}
            className="flex items-center gap-2 text-xs sm:text-sm"
          >
            {isLoadingBalances ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                Checking...
              </>
            ) : (
              <>
                <RefreshCw size={16} />
                Refresh
              </>
            )}
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-4 pb-4">
        <div className="flex flex-col gap-2">
          <CardDescription>
            To start the race, fund your wallet on each chain with a small
            amount of tokens. Click chains to select/deselect them for racing.
          </CardDescription>

          {/* Race Info */}
          <div className="text-sm text-muted-foreground">
            Selected: {selectedChains.length} chain
            {selectedChains.length !== 1 ? "s" : ""} • {transactionCount}{" "}
            transaction{transactionCount !== 1 ? "s" : ""} per chain
            {waitForReceipts && (
              <span className="block text-xs mt-1 text-amber-600">
                ⚠️ Receipt confirmation enabled - races will be slower but more
                accurate
              </span>
            )}
          </div>
        </div>

        <div className="space-y-2">
          {allChains.map((chain) => {
            const chainBalance = balances.find((b) => b.chainId === chain.id);
            const hasBalance = chainBalance?.hasBalance || false;
            const balance = chainBalance?.balance || BigInt(0);
            const isSelected = selectedChains.includes(chain.id);

            return (
              <div
                key={chain.id}
                className="flex items-center justify-between py-2 px-4 rounded-md cursor-pointer relative"
                style={{
                  backgroundColor: isSelected
                    ? `${chain.color}30`
                    : `${chain.color}15`,
                  outline: isSelected ? "2px solid #b197fc" : "none", // Light purple outline
                  boxShadow: isSelected
                    ? "0 0 8px rgba(177, 151, 252, 0.5)"
                    : "none", // Purple glow
                }}
                onClick={() => {
                  // Toggle chain selection
                  if (isSelected) {
                    // Don't allow deselecting if it's the last chain
                    if (selectedChains.length > 1) {
                      setSelectedChains((prev) =>
                        prev.filter((id) => id !== chain.id)
                      );
                    }
                  } else {
                    setSelectedChains((prev) => [...prev, chain.id]);
                  }
                }}
              >
                <div className="flex items-center gap-3">
                  <div className="relative">
                    <div className="w-8 h-8 rounded-full overflow-hidden flex-shrink-0">
                      <Image
                        src={chain.logo || "/logos/rise.png"}
                        alt={`${chain.name} Logo`}
                        width={32}
                        height={32}
                        className="w-full h-full object-cover"
                      />
                    </div>
                    {isSelected && (
                      <div className="absolute -top-1 -right-1 w-3 h-3 bg-[#b197fc] rounded-full border border-background animate-pulse"></div>
                    )}
                  </div>
                  <div>
                    <h3 className="font-medium text-black dark:text-white">
                      {chain.name}
                    </h3>
                    <p className="text-sm text-gray-700 dark:text-gray-300">
                      {chainBalance
                        ? `${formatBalance(balance, chain.id)} ${
                            "nativeCurrency" in chain
                              ? chain.nativeCurrency.symbol
                              : "SOL"
                          }`
                        : "Checking..."}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {/* Faucet link for testnet chains */}
                  {("testnet" in chain ? chain.testnet : true) &&
                    chain.faucetUrl && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-xs p-1 h-auto hover:bg-transparent opacity-70 hover:opacity-100"
                        asChild
                        onClick={(e) => e.stopPropagation()} // Prevent row click when clicking faucet
                      >
                        <a
                          href={chain.faucetUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1 text-blue-500 hover:text-blue-600"
                          title={`Get ${
                            "nativeCurrency" in chain
                              ? chain.nativeCurrency.symbol
                              : "SOL"
                          } from faucet`}
                        >
                          <Droplets size={12} />
                          <span>Faucet</span>
                        </a>
                      </Button>
                    )}

                  {!chainBalance ? (
                    <Loader2
                      size={20}
                      className="animate-spin text-muted-foreground"
                    />
                  ) : hasBalance ? (
                    // Show checkmark for selected chains with balance, circle for unselected chains with balance
                    isSelected ? (
                      <CheckCircle size={20} className="text-green-500" />
                    ) : (
                      <Circle size={20} className="text-gray-400" />
                    )
                  ) : (
                    <>
                      <XCircle size={20} className="text-red-500" />
                      {chainBalance.error && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-xs text-red-500 p-0 h-auto hover:bg-transparent"
                          title={chainBalance.error}
                          onClick={(e) => {
                            e.stopPropagation(); // Prevent row click when clicking retry
                            checkBalances();
                          }}
                        >
                          <RefreshCw size={12} className="mr-1" />
                          Retry
                        </Button>
                      )}
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
