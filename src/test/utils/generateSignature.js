// SPDX-License-Identifier: BUSL-1.1
const ethUtil = require("ethereumjs-util");
const {
  utils: { defaultAbiCoder, arrayify, verifyMessage, solidityKeccak256 },
} = require("ethers");
/**
 * Generate a valid signature that can be verified on-chain.
 * Source may be found used in ganache-core:
 *  - https://github.com/trufflesuite/ganache-core/blob/0c3979d088e4de63798fef157532fd43aec18280/lib/statemanager.js#L472
 * @param {String} dataToSign The hex string of the hash of the message to be signed.
 * @param {String} privKey The private key to use to sign WITHOUT the 0x prefix.
 * @returns {String}
 */
function generateSignature(dataToSign, privateKey) {
  const msg = Buffer.from(dataToSign.replace("0x", ""), "hex");
  const msgHash = ethUtil.hashPersonalMessage(msg);
  const sig = ethUtil.ecsign(msgHash, Buffer.from(privateKey, "hex"));
  return ethUtil.toRpcSig(sig.v, sig.r, sig.s);
}

async function signNftMintData(signer, mintParams) {
  const message = defaultAbiCoder.encode(["tuple(uint256,uint256,uint256,uint256,address,string[])"], [Object.values(mintParams)]);
  return await signer.signMessage(arrayify(message));
}
async function signPrimexMintData(signer, mintParams) {
  const message = defaultAbiCoder.encode(["tuple(uint256,uint256,address,uint256)"], [Object.values(mintParams)]);
  return await signer.signMessage(arrayify(message));
}

async function signEthMessage(signer, types, values) {
  const message = solidityKeccak256([...types], [...values]);
  const signMessage = await signer.signMessage(arrayify(message));
  const r = signMessage.slice(0, 66);
  const s = "0x" + signMessage.slice(66, 130);
  const v = "0x" + signMessage.slice(130, 132);
  return { r, s, v };
}

function recoverSignerOfNftMintData(signature, mintParams) {
  const message = defaultAbiCoder.encode(["tuple(uint256,uint256,uint256,uint256,address,string[])"], [Object.values(mintParams)]);
  return verifyMessage(arrayify(message), signature);
}

function recoverSignerOfPrimexNftMintData(signature, mintParams) {
  const message = defaultAbiCoder.encode(["tuple(uint256,uint256,address,uint256)"], [Object.values(mintParams)]);
  return verifyMessage(arrayify(message), signature);
}

module.exports = {
  generateSignature,
  signNftMintData,
  recoverSignerOfNftMintData,
  signEthMessage,
  signPrimexMintData,
  recoverSignerOfPrimexNftMintData,
};
