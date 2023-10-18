## Setup development node

All `yarn hardhat ...` commands should be run from the `./src` folder.

### Start development node and deploy all contracts:

Full initial node setup (mint, buckets, balanceVault, liquidity, priceFeed bot, etc...).
```sh
yarn hardhat node --no-deploy
yarn hardhat deployFull:devnode1 --network localhost
```

Development node should be started and running in a separate terminal for other tasks to work.

### Separate setup tasks:

Mint 100 mock WETH, WBTC, USDC, LINK tokens for deployer, lender, lender2, trader, trader2.
```sh
yarn hardhat setup:MintTokens --network localhost
```

Add three buckets (WETH, WBTC, USDC), create pTokens and debtTokens for them. 
```sh
yarn hardhat setup:Buckets --network localhost
```

Add liquidity (TestTokenA-TestTokenB) to dexes.
```sh
yarn hardhat setup:addLiquidity --network localhost
```

Setup price feed contracts. It is a prerequisite for running a priceBot.
```sh
yarn hardhat setup:PriceOracle --network localhost
```

Create few positions and make some of them risky.
```sh
yarn hardhat setup:CreatePositions --network localhost
```

### Network config

For **local** deployments use flag:
```sh
--network localhost
```

For **staging** deployments use flag:
```sh
--network <network_name>
```

Where `network_name` is one of the following:
- zksync2
- matic
- arbitrum
- goerli
- polygonZKtestnet

For **custom network** deployments use flag:
```sh
--network host
```

and define environment variable `HOST_ADDR`:
```bash
export HOST_ADDR=<rpc_endpoint>
```