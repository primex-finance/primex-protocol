# Primex Finance protocol
This repository contains the smart contracts source code and configuration files for the Primex Finance protocol. The repository uses Hardhat as a development environment for compilation, testing and deployment.

## What is Primex?
Primex Finance is a non-custodial prime brokerage protocol that connects lenders with traders, enabling traders to utilize lender liquidity for leveraged spot trading on existing DEXs like Uniswap, Balancer, Curve, and more. On Primex, traders can also benefit from CEX-like trader tooling and interfaces.

## Documentation and useful links

1. [Litepaper](https://docsend.com/view/t5g6hgqaaw78bb4z)
2. [Whitepaper](https://docsend.com/view/n7r95qmznviimhgv)
3. [Yellowpaper](https://docsend.com/view/5fshr4f7mea8v8kk)
4. [Tokenomics](https://docsend.com/view/ksq74rbbyh8wkqga)
5. [Guides](https://help.primex.finance/en/)
6. [Technical documentation](https://docs.primex.finance/)
7. [Twitter](https://twitter.com/primex_official)
8. [Discord](https://t.co/kV0bGV2niW)

## Audits

Audited by Halborn, Quantstamp, Resonance Security.

You can find all audit reports in the [audits repository](https://github.com/primex-finance/primex-audits).

## Prerequisites

- node.js v18
- yarn

## Setup

```sh
cd src
yarn install
```
Some scripts may require additional environment variables. You can install them by adding a `.env` file to the `./src` folder (see [env.template](./src/.env.template)).

## Setup account
Hardhat default generated accounts are used for testing and deployment to the localhost.

Add a `.env` file to the `./src` folder (see [env.template](./src/.env.template))

By geth keystore:
```sh
KEYSTORE_DIR=<PATH_TO_YOUR_KEYSTORE_DIR>
ADDRESS=<KEY_PUB_ADDRESS>
PASSWORD=<PASSWORD>
```

By private key:
```sh
PRIVATE_KEY=<PRIVATE_KEY>
```

## Configuration

[Setup for development](./docs/developmentSetup.md)

## Tests

Run tests:
```sh
cd src
yarn test
```

Run coverage:
```sh
COVERAGE=true

cd src
yarn hardhat coverage
```

- [unit tests](./src/test/unit/) `./src/test/unit/`
- [integration tests](./src/test/integration/) `./src/test/integration/`
- [functional tests](./src/test/) `./src/test/`

## Deployment

Docs:
- [Configs](./src/config/)
- [Scripts](./src/tasks/deployScripts/)
- [Instruction](./docs/developmentSetup.md)

### Deployment on localhost:
```sh
cd src
yarn hardhat node --no-deploy
yarn hardhat deployFull:devnode1 --network localhost
```

### Deployment on live networks:

```sh
cd src

# Network list you can find in the instruction (./docs/developmentSetup.md)
yarn hardhat deployCore --network <network_name>
```

### Deployment on custom networks:

Default config:
```sh
HOST_ADDR=<rpc_endpoint>

cd src
yarn hardhat deployFull:devnode1 --network host
```

Custom config:
[Env contracts setup tasks](./src/tasks/deployScripts/deployEnvironment/index.js)
```sh
HOST_ADDR=<rpc_endpoint>

cd src

# Deploy env contracts
yarn hardhat setup:deployEnv --network host [--flags ...]

# Deploy core and testnet services
yarn hardhat deployCoreAndTestnetServices --network host
```

## Phase switching deployment
The Primex protocol will be deployed in phases.
Each phase has a separate task.
Tasks can be found [here](./src/tasks/deployScripts/phaseSwitching/)

First phase:
```sh
HOST_ADDR=<rpc_endpoint>

cd src
yarn hardhat setup:phase-1 --network <network_name>
```


## Project contributing

When working on a project, you must adhere to the development rules described below.
All of these rules are necessary to improve the development experience.

- [Git flow](./docs/git-flow.md) - git usage rules
