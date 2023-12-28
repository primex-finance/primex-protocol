// SPDX-License-Identifier: BUSL-1.1
const { task } = require("hardhat/config");

task("setup:deployEnv", "Deploy environment with the specified parameters", require("./deployEnv.js"))
  .addFlag("isETHNotNative", "ETH is not a native token of the network")

  .addFlag("deployUniswap", "Deploy uniswapv2 and sushiswapv2 dexes and add liquidity on them")
  .addFlag("addLiquidityUniswap", "Add liquidity on uniswap v2 dexes")

  .addFlag("deployUniswapv3", "Deploy uniswapv3 and add liquidity on it")
  .addFlag("addLiquidityUniswapv3", "Add liquidity on uniswapv3 dex")

  .addFlag("deployQuickswapv3", "Deploy quickswapv3 and add liquidity on it")
  .addFlag("addLiquidityQuickswapv3", "Add liquidity on quickswapv3 dex")

  .addFlag("deployCurve", "Deploy curve and add liquidity on it")
  .addFlag("addLiquidityCurve", "Add liquidity on curve dex")

  .addFlag("deployBalancer", "Deploy balancer and add liquidity on it")
  .addFlag("addLiquidityBalancer", "Add liquidity on balancer dex")

  .addFlag("deployMeshswap", "Deploy meshswap and add liquidity on it")
  .addFlag("addLiquidityMeshswap", "Add liquidity on meshswap dex")

  .addFlag("deployUniswapMulticall", "Deploy UniswapMulticall contract");

task(
  "deployEnv:devnode1",
  "Deploy environment (test tokens, add liquidity to dexes, price feeds) on devnode1",
  require("./deployEnvDevNode1.js"),
);

task(
  "deployEnv:fuzzing",
  "Deploy environment (test tokens, add liquidity to dexes, price feeds) on devnode1",
  require("./deployEnvFuzzing.js"),
);

task(
  "deployEnv:devnode2",
  "Deploy environment (test tokens, add liquidity to dexes, price feeds) on devnode2",
  require("./deployEnvDevnode2.js"),
);

task(
  "deployEnv:devnode3",
  "Deploy environment (test tokens, add liquidity to dexes, price feeds) on devnode3",
  require("./deployEnvDevnode3.js"),
);

task(
  "deployEnv:mumbai",
  "Deploy environment (test tokens, add liquidity to dexes, price feeds) on mumbai",
  require("./deployEnvMumbai.js"),
);

task(
  "deployEnv:moonbaseAlpha",
  "Deploy environment (test tokens, add liquidity to dexes, price feeds) on moonbaseAlpha",
  require("./deployEnvMoonbaseAlpha.js"),
);

task(
  "deployEnv:obscuro",
  "Deploy environment (test tokens, add liquidity to dexes, price feeds) on obscuro",
  require("./deployEnvObscuro.js"),
);

task(
  "deployEnv:polygonZKtestnet",
  "Deploy environment (test tokens, add liquidity to dexes, price feeds) on polygonZKtestnet",
  require("./deployEnvPolygonZKtestnet.js"),
);

task(
  "deployEnv:zksync2",
  "Deploy environment (test tokens, add liquidity to dexes, price feeds) on zksync2",
  require("./deployEnvZkSync2.js"),
);

task(
  "deployEnv:arbitrum-sepolia",
  "Deploy environment (test tokens, add liquidity to dexes, price feeds) on Arbitrum Sepolia",
  require("./deployEnvArbitrumSepolia.js"),
);

task(
  "deployEnv:ethereum-sepolia",
  "Deploy environment (test tokens, add liquidity to dexes, price feeds) on Ethereum Sepolia",
  require("./deployEnvEthereumSepolia.js"),
);
