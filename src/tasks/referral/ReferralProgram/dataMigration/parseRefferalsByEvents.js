// SPDX-License-Identifier: BUSL-1.1
module.exports = async function ({ _ }, { ethers: { getContract, provider } }) {
  /* eslint eqeqeq: 0 */
  const path = require("path");
  const fs = require("fs");

  const blocksAgo = 740000;

  const pathToOldFile = path.join(__dirname, "oldFile.json");
  const pathToNewFile = path.join(__dirname, "newFile.json");
  const pathToReferralTimestampMap = path.join(__dirname, "referralTimestampMap.json");

  let oldFileObj;
  let newFileObj;

  try {
    oldFileObj = JSON.parse(fs.readFileSync(pathToOldFile));
    try {
      newFileObj = JSON.parse(fs.readFileSync(pathToNewFile));
    } catch (e) {
      // create new object
      newFileObj = { refConnections: [] };
    }
  } catch (e) {
    console.log(`ERROR: failed to read file error [${e}]`);
    return;
  }

  const latestTimeBlock = (await provider.getBlock("latest")).number;
  const block = await provider.getBlock(latestTimeBlock - blocksAgo);
  console.log(`Parse from: ${new Date(block.timestamp * 1000)}`);

  const referralProgram = await getContract("ReferralProgram");

  const filter = referralProgram.filters.RegisteredUser(null, null);
  const logsFrom = await referralProgram.queryFilter(filter, -blocksAgo);

  let referralTimestampMap;
  // for old File
  const referralReferrerMap = new Map();

  try {
    referralTimestampMap = new Map(Object.entries(JSON.parse(fs.readFileSync(pathToReferralTimestampMap))));
  } catch (e) {
    referralTimestampMap = new Map();
  }

  oldFileObj.refConnections.forEach(el => {
    el.referrals.forEach(referral => referralReferrerMap.set(referral, el.referrer));
  });

  async function canSetReferral(referral, blockNumber) {
    // check in old map file
    if (referralReferrerMap.get(referral) !== undefined) return [false, null, null];
    const block = await provider.getBlock(blockNumber);
    const data = referralTimestampMap.get(referral);
    if (data === undefined) return [true, null, block.timestamp];
    if (block.timestamp < data.timestamp) return [true, data.referrer, block.timestamp];
    return [false, null, null];
  }

  function deleteReferralFrom(referrer, referral) {
    const indexOfReferrer = newFileObj.refConnections.findIndex(el => el.referrer == referrer);
    const indexReferral = newFileObj.refConnections[indexOfReferrer].referrals.indexOf(referral);
    newFileObj.refConnections[indexOfReferrer].referrals.splice(indexReferral, 1);
  }

  for (let i = 0; i < logsFrom.length; i++) {
    const referrer = logsFrom[i].args.parent;
    const referral = logsFrom[i].args.user;

    const oldFileIndex = oldFileObj.refConnections.findIndex(el => el.referrer == referrer);
    const newFileIndex = newFileObj.refConnections.length == 0 ? -1 : newFileObj.refConnections.findIndex(el => el.referrer == referrer);
    // not found in both files
    if (oldFileIndex == -1 && newFileIndex == -1) {
      // add new referrer
      const [canSet, deleteFrom, blockTimestamp] = await canSetReferral(referral, logsFrom[i].blockNumber);
      if (canSet) {
        newFileObj.refConnections.push({
          referrer,
          referrals: [referral],
        });
        referralTimestampMap.set(referral, { referrer, timestamp: blockTimestamp });
        if (deleteFrom) deleteReferralFrom(deleteFrom, referral);
      }
      continue;
    }
    // referrer was found in the old file
    if (oldFileIndex !== -1) {
      // .. and the current referral alredy exists
      if (oldFileObj.refConnections[oldFileIndex].referrals.includes(referral)) {
        continue;
      }
    }
    // referrer was found in the new file
    if (newFileIndex !== -1) {
      const indexReferral = newFileObj.refConnections[newFileIndex].referrals.indexOf(referral);
      // but the current referral was not found
      if (indexReferral == -1) {
        const [canSet, deleteFrom, blockTimestamp] = await canSetReferral(referral, logsFrom[i].blockNumber);
        if (canSet) {
          newFileObj.refConnections[newFileIndex].referrals.push(referral);
          referralTimestampMap.set(referral, { referrer, timestamp: blockTimestamp });
        }
        if (deleteFrom) deleteReferralFrom(deleteFrom, referral);
      }
      continue;
    }
    // referrer was not found in the new file
    const [canSet, deleteFrom, blockTimestamp] = await canSetReferral(referral, logsFrom[i].blockNumber);
    if (canSet) {
      newFileObj.refConnections.push({
        referrer,
        referrals: [referral],
      });
      referralTimestampMap.set(referral, { referrer, timestamp: blockTimestamp });
      if (deleteFrom) deleteReferralFrom(deleteFrom, referral);
    }
  }

  fs.writeFileSync(pathToReferralTimestampMap, JSON.stringify(Object.fromEntries(referralTimestampMap), null, 2));
  fs.writeFileSync(pathToNewFile, JSON.stringify(newFileObj, null, 2));
};
