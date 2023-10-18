// SPDX-License-Identifier: BUSL-1.1
const { expect } = require("chai");
const { parseEther } = require("ethers/lib/utils");
const {
  network,
  ethers: {
    getContract,
    getContractFactory,
    getSigners,
    constants: { AddressZero, NegativeOne },
  },
  deployments: { fixture },
} = require("hardhat");
const { deployMockAccessControl } = require("../utils/waffleMocks");
const { BIG_TIMELOCK_ADMIN } = require("../../Constants");

process.env.TEST = true;
describe("EPMXToken_unit", function () {
  let deployer, recipient, toWhiteListAccount1, toWhiteListAccount2;
  let ErrorsLibrary, EPMXTokenFactory, mockRegistry, EPMXToken;
  let snapshotId;
  before(async function () {
    await fixture(["Errors"]);
    ErrorsLibrary = await getContract("Errors");
    [deployer, recipient, toWhiteListAccount1, toWhiteListAccount2] = await getSigners();
    mockRegistry = await deployMockAccessControl(deployer);
    await mockRegistry.mock.hasRole.withArgs(BIG_TIMELOCK_ADMIN, recipient.address).returns(false);

    EPMXTokenFactory = await getContractFactory("EPMXToken");
    EPMXToken = await EPMXTokenFactory.deploy(AddressZero, mockRegistry.address);
  });
  beforeEach(async function () {
    snapshotId = await network.provider.request({
      method: "evm_snapshot",
      params: [],
    });
  });

  afterEach(async function () {
    await network.provider.request({
      method: "evm_revert",
      params: [snapshotId],
    });
  });
  describe("deploy", function () {
    let EPMXToken, initialSupply;
    before(async function () {
      initialSupply = parseEther("1000000000");
    });

    it("Should contain tokens total supply equal to initialSupply after the contract deploy", async function () {
      EPMXToken = await EPMXTokenFactory.deploy(AddressZero, mockRegistry.address);
      expect(await EPMXToken.totalSupply()).to.equal(initialSupply);
    });

    it("Should deploy with zero recipient address and  mint total supply to deployer", async function () {
      EPMXToken = await EPMXTokenFactory.deploy(AddressZero, mockRegistry.address);
      expect(await EPMXToken.totalSupply()).to.equal(await EPMXToken.balanceOf(deployer.address));
    });
    it("Should deploy with non-zero recipient address and mint total supply to recipient", async function () {
      EPMXToken = await EPMXTokenFactory.deploy(recipient.address, mockRegistry.address);
      expect(await EPMXToken.totalSupply()).to.equal(await EPMXToken.balanceOf(recipient.address));
    });
    it("Should revert deploy if registry does not support interface", async function () {
      await mockRegistry.mock.supportsInterface.returns(false);
      await expect(EPMXTokenFactory.deploy(AddressZero, mockRegistry.address)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "ADDRESS_NOT_SUPPORTED",
      );
    });
  });

  describe("add addresses to white list", function () {
    it("Should revert addAddressToWhitelist if msg.sender doesn't have BIG_TIMELOCK_ADMIN role", async function () {
      await expect(EPMXToken.connect(recipient).addAddressToWhitelist(toWhiteListAccount1.address)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "FORBIDDEN",
      );
    });
    it("Should emit WhitelistedAddressAdded when a param 'address _address' is added to the white list", async function () {
      await expect(EPMXToken.addAddressToWhitelist(toWhiteListAccount1.address))
        .to.emit(EPMXToken, "WhitelistedAddressAdded")
        .withArgs(toWhiteListAccount1.address);
    });

    it("Should revert when a param 'address _address' is already WHITELISTED", async function () {
      await EPMXToken.addAddressToWhitelist(toWhiteListAccount1.address);
      await expect(EPMXToken.addAddressToWhitelist(toWhiteListAccount1.address)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "ADDRESS_ALREADY_WHITELISTED",
      );
    });
    it("Should revert addAddressesToWhitelist if msg.sender doesn't have BIG_TIMELOCK_ADMIN role", async function () {
      await expect(
        EPMXToken.connect(recipient).addAddressesToWhitelist([toWhiteListAccount1.address, toWhiteListAccount2.address]),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "FORBIDDEN");
    });

    it("Should emit WhitelistedAddressAdded when all addresses from a param 'address[] _addresses' are added to the white list", async function () {
      await expect(EPMXToken.addAddressesToWhitelist([toWhiteListAccount1.address, toWhiteListAccount2.address]))
        .to.emit(EPMXToken, "WhitelistedAddressAdded")
        .withArgs(toWhiteListAccount1.address)
        .to.emit(EPMXToken, "WhitelistedAddressAdded")
        .withArgs(toWhiteListAccount2.address);
    });

    it("Should revert when some members of a param 'address[] _addresses' are already WHITELISTED", async function () {
      await EPMXToken.addAddressToWhitelist(toWhiteListAccount1.address);
      await expect(
        EPMXToken.addAddressesToWhitelist([toWhiteListAccount1.address, toWhiteListAccount2.address]),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "ADDRESS_ALREADY_WHITELISTED");
    });
  });
  describe("remove addresses to white list", function () {
    it("Should revert removeAddressFromWhitelist if msg.sender doesn't have BIG_TIMELOCK_ADMIN role", async function () {
      await expect(EPMXToken.connect(recipient).removeAddressFromWhitelist(toWhiteListAccount1.address)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "FORBIDDEN",
      );
    });

    it("Should revert if a param 'address _address' is not in the white list", async function () {
      await expect(EPMXToken.removeAddressFromWhitelist(toWhiteListAccount1.address)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "ADDRESS_NOT_WHITELISTED",
      );
    });

    it("Should emit WhitelistedAddressRemoved when a param 'address _address' is removed from the white list", async function () {
      await EPMXToken.addAddressesToWhitelist([toWhiteListAccount1.address, toWhiteListAccount2.address]);
      await expect(EPMXToken.removeAddressFromWhitelist(toWhiteListAccount2.address))
        .to.emit(EPMXToken, "WhitelistedAddressRemoved")
        .withArgs(toWhiteListAccount2.address);
    });

    it("Should revert removeAddressesFromWhitelist if msg.sender doesn't have BIG_TIMELOCK_ADMIN role", async function () {
      await expect(
        EPMXToken.connect(recipient).removeAddressesFromWhitelist([toWhiteListAccount1.address, toWhiteListAccount2.address]),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "FORBIDDEN");
    });

    it("Should emit WhitelistedAddressRemoved when all addresses from a param 'address[] addresses' are removed from the white list", async function () {
      await EPMXToken.addAddressesToWhitelist([toWhiteListAccount1.address, toWhiteListAccount2.address]);
      await expect(EPMXToken.removeAddressesFromWhitelist([toWhiteListAccount1.address, toWhiteListAccount2.address]))
        .to.emit(EPMXToken, "WhitelistedAddressRemoved")
        .withArgs(toWhiteListAccount1.address)
        .to.emit(EPMXToken, "WhitelistedAddressRemoved")
        .withArgs(toWhiteListAccount2.address);
    });

    it("Should revert if some members of a param 'address[] addresses' are not in the white list", async function () {
      await EPMXToken.addAddressesToWhitelist([toWhiteListAccount1.address]);
      await expect(
        EPMXToken.removeAddressesFromWhitelist([toWhiteListAccount1.address, toWhiteListAccount2.address]),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "ADDRESS_NOT_WHITELISTED");
    });
  });

  describe("transfer functions", function () {
    let transferAmount;
    before(async function () {
      transferAmount = parseEther("1");
    });

    it("Should revert transfer if neither the sender nor the recipient is on the white list", async function () {
      await expect(EPMXToken.transfer(recipient.address, transferAmount)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "RECIPIENT_OR_SENDER_MUST_BE_ON_WHITE_LIST",
      );
    });
    it("Should transfer when the sender is on the white list", async function () {
      await EPMXToken.addAddressToWhitelist(deployer.address);
      await expect(() => EPMXToken.transfer(recipient.address, transferAmount)).to.changeTokenBalances(
        EPMXToken,
        [deployer, recipient],
        [transferAmount.mul(NegativeOne), transferAmount],
      );
    });
    it("Should transfer when the recipient is on the white list", async function () {
      await EPMXToken.addAddressToWhitelist(recipient.address);
      await expect(() => EPMXToken.transfer(recipient.address, transferAmount)).to.changeTokenBalances(
        EPMXToken,
        [deployer, recipient],
        [transferAmount.mul(NegativeOne), transferAmount],
      );
    });
  });
  describe("burn", function () {
    let transferAmount;
    before(async function () {
      transferAmount = parseEther("1");
      await EPMXToken.addAddressToWhitelist(deployer.address);
      await EPMXToken.transfer(recipient.address, transferAmount);
    });
    it("Should revert burn if the sender is not on the white list", async function () {
      await expect(EPMXToken.connect(recipient).burn(transferAmount)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "RECIPIENT_OR_SENDER_MUST_BE_ON_WHITE_LIST",
      );
    });
    it("Should burn and throw event", async function () {
      await EPMXToken.addAddressToWhitelist(recipient.address);
      await expect(EPMXToken.connect(recipient).burn(transferAmount))
        .to.emit(EPMXToken, "Burn")
        .withArgs(recipient.address, transferAmount);
    });
  });
});
