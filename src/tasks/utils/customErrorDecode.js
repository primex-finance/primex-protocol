// SPDX-License-Identifier: BUSL-1.1
module.exports = async function ({ errorData }, { ethers: { getContractFactory } }) {
  const errors = (await getContractFactory("Errors")).interface;
  const decodedError = errors.parseError(errorData);
  console.log(decodedError.signature);
  console.log(decodedError.args);
};
