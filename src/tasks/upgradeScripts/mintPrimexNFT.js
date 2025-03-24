// SPDX-License-Identifier: BUSL-1.1
const fs = require("fs");
module.exports = async function ({ _ }, { getChainId }) {
  let MintParamsForLendingNFT;
  let MintParamsForFarmingNFT;
  let MintParamsForTradingNFT;

  try {
    MintParamsForLendingNFT = JSON.parse(fs.readFileSync("./mintParamsForLendingNFT.json"));
  } catch {}

  try {
    MintParamsForFarmingNFT = JSON.parse(fs.readFileSync("./mintParamsForFarmingNFT.json"));
  } catch {}

  try {
    MintParamsForTradingNFT = JSON.parse(fs.readFileSync("./mintParamsForTradingNFT3.json"));
  } catch {}

  const chainId = await getChainId();

  if (MintParamsForLendingNFT) {
    const mintParams = MintParamsForLendingNFT.mintParams;
    for (let i = 0; i < MintParamsForLendingNFT.mintParams.length; i++) {
      mintParams[i] = [chainId, MintParamsForLendingNFT.idsStartWith + i, mintParams[i].recipient, mintParams[i].deadline];
    }
    fs.writeFileSync("./mintArgsForLendingNFT.json", JSON.stringify(mintParams, null, 2));
  }

  if (MintParamsForFarmingNFT) {
    const mintParams = MintParamsForFarmingNFT.mintParams;
    for (let i = 0; i < MintParamsForFarmingNFT.mintParams.length; i++) {
      mintParams[i] = [chainId, MintParamsForFarmingNFT.idsStartWith + i, mintParams[i].recipient, mintParams[i].deadline];
    }
    fs.writeFileSync("./mintArgsForFarmingNFT.json", JSON.stringify(mintParams, null, 2));
  }

  if (MintParamsForTradingNFT) {
    const mintParams = MintParamsForTradingNFT.mintParams;
    for (let i = 0; i < MintParamsForTradingNFT.mintParams.length; i++) {
      mintParams[i] = [chainId, MintParamsForTradingNFT.idsStartWith + i, mintParams[i].recipient, mintParams[i].deadline];
    }
    fs.writeFileSync("./mintArgsForTradingNFT3.json", JSON.stringify(mintParams, null, 2));
  }
};
