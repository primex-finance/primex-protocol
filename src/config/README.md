# Deployment config

Here are the configs that are used for deployment to different networks. Configs are stored in separate directories for each network. Also, `devnode1` configs for `buckets.json`, `pairsConfig.json` and `generalConfig.json` are used as default, if these configuration files are not found for current network.

## Addresses

The `addresses.json` contains addresses of dexes, assets, oracles.

## Pairs config

The `pairsConfig.json` contains configs for assets.

It includes:
* `maxSize`. It is maximum position size that can be created for the given assets. It may differ depending on swap direction. Contains amount of the assets, eg `maxSize=1` for ETH means 1 ETH maximum position size.
* `pairPriceDrop`. A drop of one token's price regarding another token that is possible during N seconds (for now, 600). It depends on the direction. `pairPriceDrop=1` means 100% price drop.
* `oracleTolerableLimit`. Maximum difference between swap price and oracle price. `oracleTolerableLimit=1` means 100% maximum price difference.

`maxSize` and `pairPriceDrop` depend on the order of tokens. In scripts they are set like this:  
`token0-token1=valueArray[0]`  
`token1-token0=valueArray[1]`

## Buckets config

The configuration of buckets is stored in `buckets.json`. Parameters are stored as numbers with decimal point.

Increases in deployment scripts in accordance with the 18 decimality:
* `feeBuffer`
* `withdrawalFeeRate`
* `reserveRate`

Increases in deployment scripts in accordance with the 27 decimality:
* `estimatedBar`
* `estimatedLar`
* all params of `barCalcParams`

Increases in the script deployment in accordance with the decimals of the asset:
* `maxTotalDeposit` - measured in borrowed asset.
* `LiquidityMining.accumulatingAmount` - measured in borrowed asset.
* `LiquidityMining.maxAmountPerUser` - measured in borrowed asset.
* `LiquidityMining.pmxRewardAmount` - measured in PMX.

if `LiquidityMining` is empty object then liquidity mining is off

## General config

* `EPMXOraclePrice` - measured in usd(8 decimality).
* `PositionManagerConfig`:
  + Increases in deployment scripts in accordance with the 18 decimality:
    - `defaultOracleTolerableLimit`
    - `oracleTolerableLimitMultiplier`
    - `maintenanceBuffer`
    - `securityBuffer`
  + `minPositionSize` - measured in `minPositionAsset`.
* `PrimexDNSconfig` and `SwapManagerConfig` - rates are measured in 18 decimality
* `KeeperRewardConfig`:
  + `additionalGas` and `maxGasAmount` are measured in wei
  + `defaultMaxGasPriceGwei` is measured in GWei(9 decimality)
  + `paymentModel` is name of payment model for gas in this chain
  + `dataLengthRestrictions` the restrictions for data length in the ARBITRUM payment model are measured in bytes
    - `maxRoutesLength` the maximum routes length for which an additional fee will be paid in the ARBITRUM payment model
    - `baseLength` the length of the data entering function, calculated as method signature = 4 bytes + input params: each value type = 32 bytes, array = 64 bytes, bytes = 64 bytes, if inputParams as a struct + additional 32 bytes.
  
  + other values are measured in 18 decimality
* `TreasuryConfig`:
  + `setMaxSpendingLimit`:
    - `spender` and `asset` can be set via the `address` and `contract` fields
    - `maxPercentPerTransfer` is measured in 18 decimality
    - other values are measured in `asset` decimality
* `ReserveConfig`:
  + `setTransferRestrictions`:
    - `PToken` can be set via the `address` and `contract` fields
    - `transferRestrictions.minAmountToBeLeft`is measured in `PToken` decimality
    - `transferRestrictions.minPercentOfTotalSupplyToBeLeft` is measured in 18 decimality

For all "percent" values -  0.01 = 1%
