// SPDX-License-Identifier: BUSL-1.1
module.exports = async function ({ _ }, { ethers: { getContract } }) {
  const path = require("path");
  const fs = require("fs");

  const pathToAddressesConfig = path.join(__dirname, "referralProgram.json");
  let params;

  try {
    params = JSON.parse(fs.readFileSync(pathToAddressesConfig));
  } catch (e) {
    console.log(`ERROR: failed to read file: file path [${pathToAddressesConfig}], error [${e}]`);
    return;
  }

  const referralProgram = await getContract("ReferralProgram");
  const chunkSize = 100;
  for (const referralProgramUnit of params.referralProgramUnits) {
    for (let i = 0; i < referralProgramUnit.referrals.length; i += chunkSize) {
      const chunk = referralProgramUnit.referrals.slice(i, i + chunkSize);
      const tx = await referralProgram.setReferrals([{ referrer: referralProgramUnit.referrer, referrals: chunk }]);
      await tx.wait();
      console.log("referrer", referralProgramUnit.referrer);
    }
  }
};
