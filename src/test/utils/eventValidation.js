// SPDX-License-Identifier: BUSL-1.1
const { expect } = require("chai");
const {
  ethers: {
    BigNumber: { isBigNumber },
  },
} = require("hardhat");

function getDecodedEvents(eventName, txReceipt, contract) {
  if (contract === undefined) {
    return txReceipt.events?.filter(x => {
      return x.event === eventName;
    });
  }
  const contractInterface = contract.interface;
  const events = [];

  for (const event of txReceipt.events) {
    if (event.address !== contract.address) continue;
    let log;
    // this is protect from library emit event and there isn't this event in contract abi
    try {
      log = contractInterface.parseLog(event);
    } catch {
      continue;
    }

    if (log.name === eventName) events.push(log);
  }
  return events;
}

function eventValidation(eventName, txReceipt, expectedArguments, contract = undefined, debugMode = false) {
  const events = getDecodedEvents(eventName, txReceipt, contract);
  if (events.length === 0) throw new Error("Event not found");

  let error;
  let eventMatches = false;
  for (let i = 0; i < events.length; i++) {
    try {
      parseArguments(expectedArguments, events[i].args);
      eventMatches = true;
    } catch (err) {
      error = err;
      if (debugMode) console.log(error);
    }
  }
  if (!eventMatches) {
    if (events.length !== 1) {
      error = new Error(`None of the ${events.length} events found matches the expected one`);
    }
    throw error;
  }
}

function parseArguments(expectedArguments, realArguments, errorObject = []) {
  if (typeof realArguments === "object" && !isBigNumber(realArguments)) {
    const length = realArguments.length === undefined ? Object.keys(realArguments).length : realArguments.length;
    const expectedLength = expectedArguments.length === undefined ? Object.keys(expectedArguments).length : expectedArguments.length;
    if (length !== expectedLength) throw new Error("expected number of returned variables does not match the real one");
    for (let i = 0; i < length; i++) {
      const expArgument = expectedArguments[Object.keys(expectedArguments)[i]];
      const realArgument = realArguments[Object.keys(realArguments)[i]];
      errorObject.push(Object.keys(expectedArguments)[i]);
      parseArguments(expArgument, realArgument, errorObject);
    }
    errorObject.pop();
  } else {
    try {
      expect(expectedArguments).to.equal(realArguments);
      errorObject.pop();
    } catch (err) {
      if (errorObject[errorObject.length - 1] === undefined) errorObject[errorObject.length - 1] = "undefined";
      throw new Error(errorObject.join(":") + " - " + err);
    }
  }
}

module.exports = { eventValidation, parseArguments, getDecodedEvents };
