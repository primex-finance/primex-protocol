// SPDX-License-Identifier: BUSL-1.1
module.exports = async function ({ _ }, { ethers: { getContract } }) {
  const path = require("path");
  const fs = require("fs");

  const referralProgram = await getContract("ReferralProgram");
  const referrers = await referralProgram.getReferrers();

  const data = {
    referrers: referrers,
    referralProgramUnits: [],
  };

  for (const referrer of referrers) {
    data.referralProgramUnits.push({
      referrer: referrer,
      referrals: await referralProgram.getReferralsOf(referrer),
    });
  }

  const pathToAddressesConfig = path.join(__dirname, "referralProgram.json");

  fs.writeFileSync(pathToAddressesConfig, JSON.stringify(data, null, 2));
};
