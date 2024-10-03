require("dotenv").config();

require("@typechain/hardhat");
require("@nomicfoundation/hardhat-verify");
require("@nomicfoundation/hardhat-chai-matchers");
require("@nomiclabs/hardhat-waffle");
require("@nomiclabs/hardhat-ethers");
require("hardhat-gas-reporter");
require("solidity-coverage");
require("hardhat-deploy");
require("hardhat-deploy-ethers");
require("hardhat-contract-sizer");
require("@openzeppelin/hardhat-upgrades");
require("@nomiclabs/hardhat-solhint");
require("hardhat-tracer");
require("hardhat-spdx-license-identifier");
require("hardhat-docgen");
require("hardhat-dependency-compiler");
require("@atixlabs/hardhat-time-n-mine");
require("hardhat-local-networks-config-plugin");
require("hardhat-log-remover");
require("@nomiclabs/hardhat-solhint");
require("@matterlabs/hardhat-zksync-solc");
require("@matterlabs/hardhat-zksync-deploy");
require("./tasks");

const tenderly = require("@tenderly/hardhat-tenderly");
tenderly.setup();

// You need to export an object to set up your config
// Go to https://hardhat.org/config/ to learn more

const COINMARKETCAP_API_KEY = process.env.COINMARKETCAP_API_KEY || "";
const TENDERLY_PROJECT = process.env.TENDERLY_PROJECT || "";
const TENDERLY_USERNAME = process.env.TENDERLY_USERNAME || "";
const ALCHEMY_API = process.env.ALCHEMY_API || "";
const INFURA_API_KEY = process.env.INFURA_API_KEY || "";
const HOST_ADDR = process.env.HOST_ADDR || "";
const NETWORK = process.env.NETWORK || "";

const keythereum = require("keythereum");

let accounts, urlMainnet;

if (process.env.ADDRESS && process.env.KEYSTORE_DIR && process.env.PASSWORD) {
  const keyObject = keythereum.importFromFile(process.env.ADDRESS, process.env.KEYSTORE_DIR);
  accounts = ["0x" + keythereum.recover(process.env.PASSWORD, keyObject).toString("Hex")];
} else if (process.env.PRIVATE_KEY) {
  accounts = [process.env.PRIVATE_KEY];
  if (process.env.PRIVATE_KEY_EPMX) accounts.push(process.env.PRIVATE_KEY_EPMX);
} else {
  accounts = { mnemonic: process.env.MNEMONIC || "test test test test test test test test test test test junk" };
}

if (NETWORK) {
  urlMainnet = NETWORK;
} else if (ALCHEMY_API) {
  urlMainnet = `https://eth-mainnet.alchemyapi.io/v2/${ALCHEMY_API}`;
} else {
  urlMainnet = `https://mainnet.infura.io/v3/${INFURA_API_KEY}`;
}

const hostNetworkConfig = {
  url: HOST_ADDR,
  accounts: accounts,
};
/**
 * @type import('hardhat/config').HardhatUserConfig
 */
module.exports = {
  solidity: {
    compilers: [
      {
        version: "0.8.18",
        settings: {
          optimizer: {
            runs: 200,
            enabled: true,
            // for faster development
            // details: {
            //   yul: false,
            // },
          },
          // to avoid error Variable offset is 1 slot(s) too deep inside the stack
          // https://github.com/ethereum/solidity/issues/11638
          viaIR: process.env.COVERAGE === undefined,
        },
      },
      {
        version: "0.7.6",
      },
      {
        version: "0.4.18",
      }
    ],
    overrides: {
      "@uniswap/swap-router-contracts/contracts/libraries/PoolTicksCounter.sol": {
        version: "0.7.6",
      },
      "@uniswap/swap-router-contracts/contracts/libraries/UniswapV2Library.sol": {
        version: "0.7.6",
      },
      "@uniswap/v3-core/contracts/libraries/TickBitmap.sol": {
        version: "0.7.6",
      },
    },
  },
  namedAccounts: {
    deployer: {
      default: 0,
    },
    epmxDeployer: {
      default: 1,
    },
    holder: {
      default: 1,
    },
    recipient: {
      default: 2,
    },
    caller: {
      default: 3,
    },
    lender: {
      default: 4,
    },
    lender2: {
      default: 5,
    },
    trader: {
      default: 6,
    },
    trader2: {
      default: 7,
    },
    liquidator: {
      default: 8,
    },
    user: {
      default: 9,
    },
    user2: {
      default: 10,
    },
    user3: {
      default: 11,
    },
    // Following users are needed for Aave
    aclAdmin: {
      default: 0,
    },
    emergencyAdmin: {
      default: 0,
    },
    poolAdmin: {
      default: 0,
    },
    addressesProviderRegistryOwner: {
      default: 0,
    },
    treasuryProxyAdmin: {
      default: 1,
    },
    incentivesProxyAdmin: {
      default: 1,
    },
    incentivesEmissionManager: {
      default: 0,
    },
    incentivesRewardsVault: {
      default: 0,
    },
  },
  zksolc: {
    version: "0.1.0",
    compilerSource: "docker",
    settings: {
      optimizer: {
        enabled: true,
      },
      experimental: {
        dockerImage: "matterlabs/zksolc",
      },
    },
  },
  zkSyncDeploy: {
    zkSyncNetwork: "https://zksync2-testnet.zksync.dev",
    ethNetwork: "goerli",
  },
  networks: {
    hardhat: {
      allowBlocksWithSameTimestamp: process.env.ALLOW_SAME_TIMESTAMP,
      mining: {
        auto: true,
        interval: 0,
        mempool: {
          order: "priority",
        },
      },
      allowUnlimitedContractSize: true,
    },
    zksync2: {
      zksync: true,
      url: "https://zksync2-testnet.zksync.dev",
      // ethNetwork: "goerli",
      accounts: accounts,
      chainId: 280,
    },
    localhost: {
      url: "http://127.0.0.1:8545/",
    },
    fuzzing: {
      url: "http://127.0.0.1:8545/",
    },
    host: hostNetworkConfig,
    devnode1: hostNetworkConfig,
    devnode2: hostNetworkConfig,
    devnode3: hostNetworkConfig,
    polygon: {
      url: "https://rpc.ankr.com/polygon",
      accounts: accounts,
      saveDeployments: true,
      timeout: 60000,
      gasPrice: 100e9,
    },
    mumbai: {
      url: "https://rpc.ankr.com/polygon_mumbai",
      accounts: accounts,
      saveDeployments: true,
      timeout: 60000,
    },
    arbitrumOne: {
      url: "https://arb1.arbitrum.io/rpc",
      accounts: accounts,
      saveDeployments: true,
      timeout: 60000,
    },
    arbitrumSepolia: {
      url: "https://sepolia-rollup.arbitrum.io/rpc",
      accounts: accounts,
      saveDeployments: true,
      timeout: 60000,
    },
    ethereumSepolia: {
      url: "https://rpc.notadegen.com/eth/sepolia",
      accounts: accounts,
      saveDeployments: true,
      timeout: 60000,
    },
    polygonZKtestnet: {
      url: "https://rpc.public.zkevm-test.net",
      chainId: 1442,
      accounts: accounts,
      timeout: 60000,
    },
    moonbaseAlpha: {
      url: "https://rpc.api.moonbase.moonbeam.network",
      chainId: 1287,
      accounts: accounts,
      timeout: 60000,
    },
    obscuro: {
      url: "http://127.0.0.1:3000/",
      chainId: 777,
      accounts: accounts,
      timeout: 60000,
    },
    ethereum: {
      url: "https://eth.llamarpc.com/",
      accounts: accounts,
      saveDeployments: true,
      timeout: 60000,
      gasPrice: 30e9,
    },
  },
  external: {
    contracts: [
      {
        artifacts: "node_modules/@uniswap/v2-core/build",
      },
      {
        artifacts: "node_modules/@uniswap/v2-periphery/build",
      },
      {
        artifacts: "node_modules/@uniswap/v3-core/artifacts/contracts",
      },
      {
        artifacts: "node_modules/@uniswap/v3-periphery/artifacts/contracts",
      },
      {
        artifacts: "node_modules/curve-pool-registry/build/contracts",
      },
      {
        artifacts: "node_modules/curve-contract/build/contracts",
      },
      {
        artifacts: "node_modules/ChainLink_contracts/artifacts/contracts",
      },
      {
        artifacts: "node_modules/meshswap/artifacts/contracts",
      },
      {
        deploy: "node_modules/@aave/deploy-v3/dist/deploy",
        artifacts: "node_modules/@aave/deploy-v3/artifacts",
      },
    ],
  },
  spdxLicenseIdentifier: {
    overwrite: false,
    runOnCompile: false,
  },
  dependencyCompiler: {
    paths: ["@openzeppelin/contracts/token/ERC20/IERC20.sol"],
    keep: true,
  },
  docgen: {
    path: "./docgen",
    clear: true,
    runOnCompile: true,
  },
  localNetworksConfig: `${process.cwd()}/networks.json`,
  gasReporter: {
    coinmarketcap: COINMARKETCAP_API_KEY,
    enabled: process.env.REPORT_GAS !== undefined,
    currency: "USD",
    showMethodSig: false,
    showTimeSpent: true,
  },
  etherscan: {
    apiKey: process.env.ETHERSCAN_API_KEY,
    customChains: [
      {
        network: "arbitrumSepolia",
        chainId: 421614,
        urls: {
          apiURL: "https://api-sepolia.arbiscan.io/api",
          browserURL: "https://sepolia.arbiscan.io/"
        }
      }
    ]
  },
  typechain: {
    outDir: "typechain",
    target: "ethers-v5",
  },
  contractSizer: {
    alphaSort: true,
    runOnCompile: true,
    disambiguatePaths: false,
  },
  tenderly: {
    project: TENDERLY_PROJECT,
    username: TENDERLY_USERNAME,
  },
  mocha: {
    timeout: 200000,
  },
};
