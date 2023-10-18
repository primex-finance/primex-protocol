// SPDX-License-Identifier: BUSL-1.1
const { getContractAbi } = require("./utils.js");
const { BigNumber } = require("ethers");

module.exports = async function (
  { factory, assets, from, fee },
  {
    ethers: {
      getNamedSigners,
      getContract,
      getContractAt,
      utils: { parseUnits },
    },
  },
) {
  assets = JSON.parse(assets);
  // 0.1 WAD
  const MIN_WEIGHT = parseUnits("1", "17");
  // 1 WAD
  const ONE = parseUnits("1", "18");
  // 0.000001 WAD
  const MIN_FEE = parseUnits("1", "12");
  const signers = await getNamedSigners();
  from = signers[from];
  if (from === undefined) throw new Error(`signer ${from} undefined`);
  let weightSum = BigNumber.from(0);
  assets.forEach(asset => {
    // The weight must be great then 0.1 WAD and lower then 1 WAD
    asset.weight = parseUnits(asset.weight, "17");
    if (asset.weight < MIN_WEIGHT) throw new Error("The token weight must be greater than the min_weight");
    weightSum = weightSum.add(asset.weight);
  });
  if (!weightSum.eq(ONE)) throw new Error("The sum of token weights must be equal to the ONE");

  if (fee) {
    if (BigNumber.from(fee).lt(MIN_FEE)) throw new Error("The fee must be greater than or equal to the MIN_FEE");
  } else {
    fee = MIN_FEE;
  }
  assets.sort((a, b) => {
    return BigNumber.from(a.token).sub(b.token).isNegative() ? -1 : 1;
  });
  const tokens = [];
  const weights = [];
  let poolSymbol = "";
  for (let i = 0; i < assets.length; i++) {
    tokens[i] = assets[i].token;
    weights[i] = assets[i].weight;
    poolSymbol = poolSymbol + (await (await getContractAt("ERC20Mock", tokens[i])).symbol()) + (i === assets.length - 1 ? "" : "--");
  }
  const poolName = "Test Pool";
  const FactoryContract = await getContractAt(await getContractAbi("WeightedPoolFactory"), factory);
  const tx = await FactoryContract.connect(from).create(poolName, poolSymbol, tokens, weights, fee, from.address);
  const receipt = await tx.wait();
  const events = receipt.events.filter(e => e.event === "PoolCreated");
  // return the poolId
  return events[0].args.pool;
};
