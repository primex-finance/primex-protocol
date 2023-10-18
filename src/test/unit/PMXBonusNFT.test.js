// SPDX-License-Identifier: BUSL-1.1
const { expect } = require("chai");
const {
  run,
  network,
  upgrades,
  ethers: {
    getContract,
    getContractAt,
    getContractFactory,
    getSigners,
    constants: { AddressZero },
    utils: { keccak256, toUtf8Bytes },
  },

  deployments: { fixture },
} = require("hardhat");
const { signNftMintData, recoverSignerOfNftMintData } = require("../utils/generateSignature.js");
const { parseArguments } = require("../utils/eventValidation");
const { BIG_TIMELOCK_ADMIN, SMALL_TIMELOCK_ADMIN, EMERGENCY_ADMIN } = require("../../Constants");

process.env.TEST = true;

const {
  deployBonusExecutor,
  deployMockBucket,
  deployMockPrimexDNS,
  deployMockAccessControl,
  deployMockWhiteBlackList,
} = require("../utils/waffleMocks");
describe("PrimexNFT_unit", function () {
  let deployer, user;
  let PMXBonusNFT, mockRegistry;
  let mockExecutor, mockBucket;
  let snapshotId;
  let metaData, mintParams, signature, NFT_MINTER;
  let uris;
  let mockPrimexDNS, mockWhiteBlackList;
  let ErrorsLibrary;

  before(async function () {
    await fixture(["Errors", "PrimexProxyAdmin"]);
    [deployer, user] = await getSigners();

    ErrorsLibrary = await getContract("Errors");
    mockExecutor = await deployBonusExecutor(deployer);
    mockBucket = await deployMockBucket(deployer);
    mockRegistry = await deployMockAccessControl(deployer);

    mockPrimexDNS = await deployMockPrimexDNS(deployer);
    mockWhiteBlackList = await deployMockWhiteBlackList(deployer);
    await mockPrimexDNS.mock.getBucketAddress.returns(mockBucket.address);
    NFT_MINTER = keccak256(toUtf8Bytes("NFT_MINTER"));

    const deploymentPMXBonusNFT = await run("deploy:PMXBonusNFT", {
      primexDNS: mockPrimexDNS.address,
      registry: mockRegistry.address,
      whiteBlackList: mockWhiteBlackList.address,
    });

    PMXBonusNFT = await getContractAt("PMXBonusNFT", deploymentPMXBonusNFT.address);

    mintParams = {
      bonusTypeId: 1,
      tier: 3,
      chainId: network.config.chainId,
      id: 99,
      recipient: deployer.address,
      uris: ["primexURL/" + "99" + "0", "primexURL/" + "99" + "1"],
    };
    metaData = {
      bucket: AddressZero,
      bonusTypeId: 1,
      tier: 3,
      activatedBy: AddressZero,
      uri: "primexURL/" + mintParams.id.toString() + "0",
    };

    uris = ["primexURL/" + mintParams.id.toString() + "0", "primexURL/" + mintParams.id.toString() + "1"];

    signature = await signNftMintData(deployer, mintParams);

    await mockExecutor.mock.supportsInterface.returns(true);
    await PMXBonusNFT.setExecutor(1, mockExecutor.address);
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

  describe("initialize", function () {
    it("Should revert deploy if primexDNS does not support interface", async function () {
      await mockPrimexDNS.mock.supportsInterface.returns(false);
      const pmxBonusNftFactory = await getContractFactory("PMXBonusNFT");
      await expect(
        upgrades.deployProxy(pmxBonusNftFactory, [mockPrimexDNS.address, mockRegistry.address, mockWhiteBlackList.address], {
          unsafeAllow: ["constructor", "delegatecall"],
        }),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "ADDRESS_NOT_SUPPORTED");
    });
    it("Should revert deploy if registry does not support interface", async function () {
      await mockRegistry.mock.supportsInterface.returns(false);
      const pmxBonusNftFactory = await getContractFactory("PMXBonusNFT");
      await expect(
        upgrades.deployProxy(pmxBonusNftFactory, [mockPrimexDNS.address, mockRegistry.address, mockWhiteBlackList.address], {
          unsafeAllow: ["constructor", "delegatecall"],
        }),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "ADDRESS_NOT_SUPPORTED");
    });
  });

  describe("blockNft", function () {
    before(async function () {
      await mockExecutor.mock.deactivateBonus.returns();
    });
    it("Should revert if not SMALL_TIMELOCK_ADMIN call blockNft", async function () {
      await PMXBonusNFT["mint(bytes,(uint256,uint256,uint256,uint256,address,string[]))"](signature, mintParams);
      await mockRegistry.mock.hasRole.withArgs(SMALL_TIMELOCK_ADMIN, user.address).returns(false);

      await expect(PMXBonusNFT.connect(user).blockNft(mintParams.id)).to.be.revertedWithCustomError(ErrorsLibrary, "FORBIDDEN");
    });
    it("Should block NFT", async function () {
      await PMXBonusNFT["mint(bytes,(uint256,uint256,uint256,uint256,address,string[]))"](signature, mintParams);

      expect(await PMXBonusNFT.blockNft(mintParams.id));
      await expect(
        PMXBonusNFT["mint(bytes,(uint256,uint256,uint256,uint256,address,string[]))"](signature, mintParams),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "TOKEN_IS_BLOCKED");
      await expect(PMXBonusNFT["mint((uint256,uint256,uint256,uint256,address,string[]))"](mintParams)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "TOKEN_IS_BLOCKED",
      );
      await expect(PMXBonusNFT.activate(mintParams.id, "bucket1")).to.be.revertedWithCustomError(ErrorsLibrary, "TOKEN_IS_BLOCKED");
    });
    it("Should emit BlockedNftWithId when NFT is blocked", async function () {
      await PMXBonusNFT["mint(bytes,(uint256,uint256,uint256,uint256,address,string[]))"](signature, mintParams);
      await expect(PMXBonusNFT.blockNft(mintParams.id)).to.emit(PMXBonusNFT, "BlockedNftWithId").withArgs(mintParams.id);
    });
  });
  describe("unblockNft", function () {
    before(async function () {
      await mockExecutor.mock.deactivateBonus.returns();
    });
    it("Should revert if not SMALL_TIMELOCK_ADMIN call blockNft", async function () {
      await mockRegistry.mock.hasRole.withArgs(SMALL_TIMELOCK_ADMIN, user.address).returns(false);
      await expect(PMXBonusNFT.connect(user).unblockNft(mintParams.id)).to.be.revertedWithCustomError(ErrorsLibrary, "FORBIDDEN");
    });
    it("Should  unblock NFT", async function () {
      expect(await PMXBonusNFT.blockNft(mintParams.id));
      await expect(
        PMXBonusNFT["mint(bytes,(uint256,uint256,uint256,uint256,address,string[]))"](signature, mintParams),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "TOKEN_IS_BLOCKED");

      await PMXBonusNFT.unblockNft(mintParams.id);

      await PMXBonusNFT["mint(bytes,(uint256,uint256,uint256,uint256,address,string[]))"](signature, mintParams);
    });
    it("Should emit UnblockedNftWithId when NFT is unblocked", async function () {
      await PMXBonusNFT["mint(bytes,(uint256,uint256,uint256,uint256,address,string[]))"](signature, mintParams);
      await PMXBonusNFT.blockNft(mintParams.id);
      await expect(PMXBonusNFT.unblockNft(mintParams.id)).to.emit(PMXBonusNFT, "UnblockedNftWithId").withArgs(mintParams.id);
    });
  });
  describe("setExecutor", function () {
    before(async function () {
      await mockExecutor.mock.deactivateBonus.returns();
    });
    it("Should revert if not BIG_TIMELOCK_ADMIN call setExecutor", async function () {
      await mockRegistry.mock.hasRole.withArgs(BIG_TIMELOCK_ADMIN, user.address).returns(false);
      await expect(PMXBonusNFT.connect(user).setExecutor(5, mockExecutor.address)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "FORBIDDEN",
      );
    });
    it("Should revert setExecutor if executor ADDRESS_NOT_SUPPORTED", async function () {
      await mockExecutor.mock.supportsInterface.returns(false);

      await expect(PMXBonusNFT.connect(user).setExecutor(5, mockExecutor.address)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "ADDRESS_NOT_SUPPORTED",
      );
    });
    it("Should setExecutor", async function () {
      await PMXBonusNFT.connect(user).setExecutor(5, mockExecutor.address);
      expect(await PMXBonusNFT.bonusExecutors(5)).to.equal(mockExecutor.address);
    });

    it("Should emit ExecutorChanged when set is successful", async function () {
      await expect(PMXBonusNFT.connect(user).setExecutor(5, mockExecutor.address))
        .to.emit(PMXBonusNFT, "ExecutorChanged")
        .withArgs(mockExecutor.address);
    });
  });
  describe("mint with signature", function () {
    it("Should mint and returns the correct meta data and minter's balanceOf", async function () {
      await PMXBonusNFT["mint(bytes,(uint256,uint256,uint256,uint256,address,string[]))"](signature, mintParams);
      parseArguments(await PMXBonusNFT.getNft(mintParams.id), metaData);
      expect(await PMXBonusNFT.balanceOf(deployer.address))
        .to.be.eq(await PMXBonusNFT.totalSupply())
        .to.be.eq(1);
    });
    it("Should mint NFT to recipient when message sender isn't recipient", async function () {
      await PMXBonusNFT.connect(user)["mint(bytes,(uint256,uint256,uint256,uint256,address,string[]))"](signature, mintParams);
      parseArguments(await PMXBonusNFT.getNft(mintParams.id), metaData);
      expect(await PMXBonusNFT.balanceOf(deployer.address))
        .to.be.eq(await PMXBonusNFT.totalSupply())
        .to.be.eq(1);
    });

    it("Should revert mint when message signer doesn't have NFT_MINTER role", async function () {
      await mockRegistry.mock.hasRole.withArgs(NFT_MINTER, user.address).returns(false);

      const badSignature = await signNftMintData(user, mintParams);
      await expect(
        PMXBonusNFT["mint(bytes,(uint256,uint256,uint256,uint256,address,string[]))"](badSignature, mintParams),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "FORBIDDEN");
    });
    it("Should revert mint when msg.sender is on the blacklist", async function () {
      await mockWhiteBlackList.mock.isBlackListed.returns(true);
      await expect(
        PMXBonusNFT["mint(bytes,(uint256,uint256,uint256,uint256,address,string[]))"](signature, mintParams),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "SENDER_IS_BLACKLISTED");
    });
    it("Should revert mint when message isn't that owner sign", async function () {
      const badMintParams = { ...mintParams };
      badMintParams.id = 200;

      const recoveredAddress = recoverSignerOfNftMintData(signature, badMintParams);
      await mockRegistry.mock.hasRole.withArgs(NFT_MINTER, recoveredAddress).returns(false);

      await expect(
        PMXBonusNFT["mint(bytes,(uint256,uint256,uint256,uint256,address,string[]))"](signature, badMintParams),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "FORBIDDEN");
    });
    it("Should revert mint when chainId doesn't match", async function () {
      const mintParamsForOtherNetwork = { ...mintParams };
      mintParamsForOtherNetwork.chainId = 200;
      const signaturForOtherNetworke = await signNftMintData(deployer, mintParamsForOtherNetwork);
      await expect(
        PMXBonusNFT["mint(bytes,(uint256,uint256,uint256,uint256,address,string[]))"](signaturForOtherNetworke, mintParamsForOtherNetwork),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "WRONG_NETWORK");
    });
    it("Should revert mint when uris length is zero", async function () {
      const mintParamsWithZeroUris = { ...mintParams };
      mintParamsWithZeroUris.uris = [];
      await expect(
        PMXBonusNFT["mint(bytes,(uint256,uint256,uint256,uint256,address,string[]))"](signature, mintParamsWithZeroUris),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "WRONG_URIS_LENGTH");
    });
    it("Should revert double mint by one signature", async function () {
      await PMXBonusNFT["mint(bytes,(uint256,uint256,uint256,uint256,address,string[]))"](signature, mintParams);
      await expect(PMXBonusNFT["mint(bytes,(uint256,uint256,uint256,uint256,address,string[]))"](signature, mintParams)).to.be.revertedWith(
        "ERC721: token already minted",
      );
    });
  });

  describe("mint by minter", function () {
    it("Should mint and returns the correct meta data and recipient balanceOf", async function () {
      await mockRegistry.mock.hasRole.withArgs(NFT_MINTER, deployer.address).returns(true);
      await PMXBonusNFT["mint((uint256,uint256,uint256,uint256,address,string[]))"](mintParams);
      parseArguments(await PMXBonusNFT.getNft(mintParams.id), metaData);
      expect(await PMXBonusNFT.balanceOf(deployer.address))
        .to.be.eq(await PMXBonusNFT.totalSupply())
        .to.be.eq(1);
    });

    it("Should revert mint when msg.sender isn't minter", async function () {
      await mockRegistry.mock.hasRole.withArgs(NFT_MINTER, deployer.address).returns(false);
      await expect(PMXBonusNFT["mint((uint256,uint256,uint256,uint256,address,string[]))"](mintParams)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "FORBIDDEN",
      );
    });

    it("Should revert mint when chainId doesn't match", async function () {
      await mockRegistry.mock.hasRole.withArgs(NFT_MINTER, deployer.address).returns(true);
      const mintParamsForOtherNetwork = { ...mintParams };
      mintParamsForOtherNetwork.chainId = 200;
      await expect(
        PMXBonusNFT["mint((uint256,uint256,uint256,uint256,address,string[]))"](mintParamsForOtherNetwork),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "WRONG_NETWORK");
    });
    it("Should revert double mint with the same id", async function () {
      await mockRegistry.mock.hasRole.withArgs(NFT_MINTER, deployer.address).returns(true);

      await PMXBonusNFT["mint((uint256,uint256,uint256,uint256,address,string[]))"](mintParams);
      await expect(PMXBonusNFT["mint((uint256,uint256,uint256,uint256,address,string[]))"](mintParams)).to.be.revertedWith(
        "ERC721: token already minted",
      );
    });
  });
  it("tokenUri should return correct state", async function () {
    await PMXBonusNFT["mint(bytes,(uint256,uint256,uint256,uint256,address,string[]))"](signature, mintParams);
    expect(await PMXBonusNFT.tokenURI(mintParams.id)).to.equal(metaData.uri);
  });

  it("tokenUri should return correct state when nft activated", async function () {
    await PMXBonusNFT["mint(bytes,(uint256,uint256,uint256,uint256,address,string[]))"](signature, mintParams);
    await mockExecutor.mock.activateBonus.returns();
    await PMXBonusNFT.activate(mintParams.id, "bucket1");
    expect(await PMXBonusNFT.tokenURI(mintParams.id)).to.equal(metaData.uri.slice(-metaData.length, -1) + "1");
  });

  it("Should revert getNft when the id doesn't exist", async function () {
    await PMXBonusNFT["mint(bytes,(uint256,uint256,uint256,uint256,address,string[]))"](signature, mintParams);
    await expect(PMXBonusNFT.getNft(1)).to.be.revertedWithCustomError(ErrorsLibrary, "ID_DOES_NOT_EXIST");
  });

  it("Should return the correct uri when the token is not activated", async function () {
    await PMXBonusNFT["mint(bytes,(uint256,uint256,uint256,uint256,address,string[]))"](signature, mintParams);
    expect((await PMXBonusNFT.getNft(mintParams.id)).uri).to.deep.equal(metaData.uri);
    expect(await PMXBonusNFT.tokenURI(mintParams.id)).to.deep.equal(uris[0]);
  });

  it("Should return the correct uri when the token is activated", async function () {
    await mockExecutor.mock.activateBonus.returns();
    await PMXBonusNFT["mint(bytes,(uint256,uint256,uint256,uint256,address,string[]))"](signature, mintParams);
    await PMXBonusNFT.activate(mintParams.id, "bucket1");
    expect((await PMXBonusNFT.getNft(mintParams.id)).uri).to.deep.equal(uris[1]);
  });

  it("Should revert activate when id does not exist", async function () {
    await expect(PMXBonusNFT.activate(1, "bucket1")).to.be.revertedWithCustomError(ErrorsLibrary, "ID_DOES_NOT_EXIST");
  });
  it("Should revert activate when the msg.sender is on the blacklist", async function () {
    await mockExecutor.mock.activateBonus.returns();
    await PMXBonusNFT["mint(bytes,(uint256,uint256,uint256,uint256,address,string[]))"](signature, mintParams);

    await mockWhiteBlackList.mock.isBlackListed.returns(true);
    await expect(PMXBonusNFT.activate(mintParams.id, "bucket1")).to.be.revertedWithCustomError(ErrorsLibrary, "SENDER_IS_BLACKLISTED");
  });

  it("Should revert activate when wrong caller", async function () {
    await PMXBonusNFT["mint(bytes,(uint256,uint256,uint256,uint256,address,string[]))"](signature, mintParams);
    await expect(PMXBonusNFT.connect(user).activate(mintParams.id, "bucket1")).to.be.revertedWithCustomError(
      ErrorsLibrary,
      "CALLER_IS_NOT_OWNER",
    );
  });

  it("Should activate NFT", async function () {
    await mockExecutor.mock.activateBonus.returns();
    await PMXBonusNFT["mint(bytes,(uint256,uint256,uint256,uint256,address,string[]))"](signature, mintParams);
    expect((await PMXBonusNFT.getNft(mintParams.id)).activatedBy).to.equal(AddressZero);
    expect(await PMXBonusNFT.activate(mintParams.id, "bucket1"));
    expect((await PMXBonusNFT.getNft(mintParams.id)).activatedBy).to.equal(deployer.address);
  });

  it("Should revert activate when token already activated", async function () {
    await mockExecutor.mock.activateBonus.returns();
    await PMXBonusNFT["mint(bytes,(uint256,uint256,uint256,uint256,address,string[]))"](signature, mintParams);
    expect(await PMXBonusNFT.activate(mintParams.id, "bucket1"));
    await expect(PMXBonusNFT.activate(mintParams.id, "bucket1")).to.be.revertedWithCustomError(ErrorsLibrary, "TOKEN_IS_ALREADY_ACTIVATED");
  });

  it("Should revert token activation when the program is paused", async function () {
    await PMXBonusNFT["mint(bytes,(uint256,uint256,uint256,uint256,address,string[]))"](signature, mintParams);
    await PMXBonusNFT.pause();
    await expect(PMXBonusNFT.activate(mintParams.id, "bucket1")).to.be.revertedWith("Pausable: paused");
  });

  describe("pause & unpause", function () {
    it("Should revert if not EMERGENCY_ADMIN call pause", async function () {
      await mockRegistry.mock.hasRole.withArgs(EMERGENCY_ADMIN, user.address).returns(false);
      await expect(PMXBonusNFT.connect(user).pause()).to.be.revertedWithCustomError(ErrorsLibrary, "FORBIDDEN");
    });
    it("Should revert if not SMALL_TIMELOCK_ADMIN call unpause", async function () {
      await PMXBonusNFT.pause();
      await mockRegistry.mock.hasRole.withArgs(SMALL_TIMELOCK_ADMIN, user.address).returns(false);
      await expect(PMXBonusNFT.connect(user).unpause()).to.be.revertedWithCustomError(ErrorsLibrary, "FORBIDDEN");
    });
  });
});
