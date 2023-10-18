// SPDX-License-Identifier: BUSL-1.1
const { getContractAbi } = require("./utils.js");
const { BigNumber } = require("ethers");
module.exports = async function (
  { pool, vault, from, assets, to },
  {
    ethers: {
      getNamedSigners,
      getContractAt,
      utils: { parseUnits, defaultAbiCoder },
    },
  },
) {
  let lpAmountReceived;

  const signers = await getNamedSigners();

  if (signers[from] !== undefined) {
    from = signers[from];
  }
  if (signers[to] !== undefined) {
    to = signers[to].address;
  }
  vault = await getContractAt(await getContractAbi("Vault"), vault);

  const poolContract = await getContractAt(await getContractAbi("WeightedPool"), pool);
  const poolId = await poolContract.getPoolId();
  lpAmountReceived = await poolContract.balanceOf(to);

  assets = JSON.parse(assets);
  assets.sort((a, b) => {
    return BigNumber.from(a.token).sub(b.token).isNegative() ? -1 : 1;
  });

  const tokens = [];
  const amounts = [];
  for (let i = 0; i < assets.length; i++) {
    const tokenContract = await getContractAt("ERC20Mock", assets[i].token);
    tokens[i] = assets[i].token;
    amounts[i] = parseUnits(assets[i].amount, await tokenContract.decimals());

    const thTokenApprove = await tokenContract.connect(from).approve(vault.address, amounts[i]);
    await thTokenApprove.wait();
  }

  const JOIN_KIND_INIT = 0;
  const initUserData = defaultAbiCoder.encode(["uint256", "uint256[]"], [JOIN_KIND_INIT, amounts]);

  const joinPoolRequest = {
    assets: tokens,
    maxAmountsIn: amounts,
    userData: initUserData,
    fromInternalBalance: false,
  };

  const txJoinPool = await vault.connect(from).joinPool(poolId, from.address, to, joinPoolRequest);
  await txJoinPool.wait();

  lpAmountReceived = (await poolContract.balanceOf(to)).sub(lpAmountReceived);

  return lpAmountReceived;
};
