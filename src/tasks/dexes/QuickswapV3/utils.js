// SPDX-License-Identifier: BUSL-1.1
const QuoterArtifact = require("@cryptoalgebra-fork/src/periphery/artifacts/contracts/lens/Quoter.sol/Quoter.json");
const QuoterV2Artifact = require("@cryptoalgebra-fork/src/periphery/artifacts/contracts/lens/QuoterV2.sol/QuoterV2.json");
const SwapRouterArtifact = require("@cryptoalgebra-fork/src/periphery/artifacts/contracts/SwapRouter.sol/SwapRouter.json");
const NonfungiblePositionManagerArtifact = require("@cryptoalgebra-fork/src/periphery/artifacts/contracts/NonfungiblePositionManager.sol/NonfungiblePositionManager.json");
const AlgebraPoolDeployerArtifact = require("@cryptoalgebra-fork/src/core/artifacts/contracts/AlgebraPoolDeployer.sol/AlgebraPoolDeployer.json");
const AlgebraFactoryArtifact = require("@cryptoalgebra-fork/src/core/artifacts/contracts/AlgebraFactory.sol/AlgebraFactory.json");
const AlgebraPool = require("@cryptoalgebra-fork/src/core/artifacts/contracts/AlgebraPool.sol/AlgebraPool.json");

module.exports = {
  AlgebraPool,
  AlgebraPoolDeployerArtifact,
  AlgebraFactoryArtifact,
  QuoterArtifact,
  QuoterV2Artifact,
  SwapRouterArtifact,
  NonfungiblePositionManagerArtifact,
};
