const web3 = global.web3
const DIDToken = artifacts.require('DIDToken')
const Distense = artifacts.require('Distense')
const utils = require('./helpers/utils')

import { convertSolidityIntToInt } from './helpers/utils'

contract('Distense contract', function(accounts) {
  const proposalPctDIDToApproveParameter = {
    title: 'proposalPctDIDToApprove',
    value: 25 // CLIENT VALUE (not multiplied by 10) Hard coded in constructor function in contract
  }

  const pullRequestPctDIDParameter = {
    title: 'pctDIDRequiredToMergePullRequest',
    // Hard coded in constructor function in contract
    // CLIENT VALUE (not multiplied by 10)
    value: 10
  }

  const votingIntervalParameter = {
    title: 'votingInterval',
    // Equal to 15 days in Solidity
    // CLIENT VALUE (not multiplied by 10)
    value: 129600000
  }

  it('should set the initial attributes correctly', async function() {
    let param = await distense.getParameterByTitle(
      pullRequestPctDIDParameter.title
    )
    assert.equal(
      utils.stripHexStringOfZeroes(param[0]),
      pullRequestPctDIDParameter.title
    )
    assert.equal(
      utils.convertSolidityIntToInt(param[1].toNumber()),
      pullRequestPctDIDParameter.value,
      'proposalPctDIDToApprove value incorrect'
    )
  })

  it('should set the proposalPctDIDApprovalParameter correctly', async function() {
    let param = await distense.getParameterByTitle(
      proposalPctDIDToApproveParameter.title
    )

    assert.equal(
      utils.stripHexStringOfZeroes(param[0].toString()),
      proposalPctDIDToApproveParameter.title
    )
    assert.equal(
      utils.convertSolidityIntToInt(param[1].toNumber()),
      proposalPctDIDToApproveParameter.value
    )
  })

  it('should set the initial attributes correctly', async function() {
    const numParameters = await distense.getNumParameters.call()
    assert.equal(numParameters.toNumber(), 10)
  })

  it('should reject parameter votes with values equal to the current value', async function() {
    let equalValueError
    const didToken = await DIDToken.new()

    const distense = await Distense.new(didToken.address)
    try {
      await distense.voteOnParameter(
        pullRequestPctDIDParameter.title,
        pullRequestPctDIDParameter.value
      )
    } catch (error) {
      equalValueError = error
    }
    assert.notEqual(equalValueError, undefined, 'Error must be thrown')

    let votingIntervalParameterError
    try {
      await distense.voteOnParameter(params[2].title, params[2].value)
    } catch (error) {
      votingIntervalParameterError = error
    }
    assert.notEqual(
      votingIntervalParameterError,
      undefined,
      'Error must be thrown'
    )
  })

  it(`should disallow voting for those who don't own DID`, async function() {
    let equalValueError
    try {
      await distense.voteOnParameter(pullRequestPctDIDParameter.title, 122, {
        from: accounts[2] // no DID for this account
      })
    } catch (error) {
      equalValueError = error
    }
    assert.notEqual(
      equalValueError,
      undefined,
      "reject parameter votes from those who don't own DID"
    )
  })

  //  Begin accounts[0] owns 2000 or 100%
  let didToken
  let distense

  beforeEach(async function() {
    didToken = await DIDToken.new()
    didToken.issueDID(accounts[0], 2000)
    distense = await Distense.new(didToken.address)
  })

  it(`should restrict voting again if the votingInterval hasn't passed`, async function() {
    let contractError

    try {
      const userBalance = await didToken.balances.call(accounts[0])
      assert.isAbove(userBalance, 0, 'user should have DID here to vote')

      await distense.voteOnParameter(
        votingIntervalParameter.title,
        votingIntervalParameter.value + 1
      )

      await distense.voteOnParameter(
        votingIntervalParameter.title,
        votingIntervalParameter.value + 1
      )
    } catch (error) {
      contractError = error
      // assertJump(error)
    }

    assert.notEqual(
      contractError,
      undefined,
      'should throw an error because the voter is trying to vote twice'
    )
  })

  it(`should allow voting only after the votingInterval has passed`, async function() {
    const userBalance = await didToken.balances.call(accounts[0])
    assert.isAbove(userBalance, 0, 'user should have DID here to vote')

    let contractError
    try {
      await distense.voteOnParameter(
        votingIntervalParameter.title,
        votingIntervalParameter.value + 123
      )

      await distense.voteOnParameter(
        votingIntervalParameter.title,
        votingIntervalParameter.value + 1
      )
    } catch (error) {
      contractError = error
    }

    assert.notEqual(
      contractError,
      undefined,
      'should throw an error because the voter is trying to vote twice'
    )
  })

  it(`should properly update the votingInterval parameter value when voted upon with the proper requirements`, async function() {
    const userBalance = await didToken.balances.call(accounts[0])
    assert.isAbove(
      userBalance.toNumber(),
      convertSolidityIntToInt(2000),
      'user should have DID here to vote'
    )

    await distense.voteOnParameter(votingIntervalParameter.title, 1)

    const newValue = await distense.getParameterValueByTitle.call(
      votingIntervalParameter.title
    )

    assert.equal(
      newValue.toNumber(),
      votingIntervalParameter.value * 1.25, // limited to 25% increase
      'updated value should be twice the original value as the voter owns 100% of the DID'
    )
  })

  it(`should properly update the pullRequestPctDIDParameter value when upvoted with the proper requirements`, async function() {
    const userBalance = await didToken.balances.call(accounts[0])
    assert.isAbove(
      userBalance.toNumber(),
      convertSolidityIntToInt(2000),
      'user should have DID here to vote'
    )

    await distense.voteOnParameter(pullRequestPctDIDParameter.title, -1)

    const newValue = await distense.getParameterValueByTitle(
      pullRequestPctDIDParameter.title
    )

    assert.equal(
      convertSolidityIntToInt(newValue.toNumber()),
      pullRequestPctDIDParameter.value * 0.75,
      'updated value should be 10% greater than the original value as the voter owns 100% of the DID'
    )
  })

  function calcCorrectUpdatedParameterValue(pctDIDOwned, originalValue, vote) {
    const limitTo25PercentIfHigher = (pctDIDOwned > 25 ? 25 : pctDIDOwned) / 100

    const update = originalValue * limitTo25PercentIfHigher
    if (vote === 1) originalValue += update
    else originalValue -= update

    return originalValue
  }

  it(`should properly update the proposalPctDIDToApproveParameter value`, async function() {
    await didToken.issueDID(accounts[1], 2000)

    let newContractValue
    let correctValue
    let vote
    let pctDIDOwned

    //  Downvote by 50% owner -- should be limited to 25% down from original value of 25%
    pctDIDOwned = convertSolidityIntToInt(
      await didToken.pctDIDOwned(accounts[0])
    )
    vote = -1
    await distense.voteOnParameter(proposalPctDIDToApproveParameter.title, vote)
    correctValue = calcCorrectUpdatedParameterValue(
      pctDIDOwned,
      proposalPctDIDToApproveParameter.value,
      vote
    )
    newContractValue = convertSolidityIntToInt(
      await distense.getParameterValueByTitle(
        proposalPctDIDToApproveParameter.title
      )
    )
    assert.equal(
      newContractValue,
      correctValue,
      'updated value should be lower by the percentage of DID ownership of the voter'
    )
  })

  it(`should properly update the proposalPctDIDToApproveParameter value`, async function() {
    await didToken.issueDID(accounts[1], 2000)
    await didToken.issueDID(accounts[2], 2000)

    let vote = -1
    //  total DID at this point is 2000 + 2000 + 4321 == 8321 DID
    //  so accounts[0], the voter owns 24%
    await distense.voteOnParameter(proposalPctDIDToApproveParameter.title, vote)

    let newContractValue = await distense.getParameterValueByTitle(
      proposalPctDIDToApproveParameter.title
    )
    assert.equal(
      newContractValue,
      1875,
      'updated value should be lower by the percentage of DID ownership of the voter'
    )

    await didToken.issueDID(accounts[3], 2000)

    vote = 1
    // //  total DID at this point is 2000 + 2000 + 4321 == 8321 DID
    // //  so accounts[0], the voter owns 24%
    await distense.voteOnParameter(
      proposalPctDIDToApproveParameter.title,
      vote,
      {
        from: accounts[1]
      }
    )
    newContractValue = await distense.getParameterValueByTitle(
      proposalPctDIDToApproveParameter.title
    )
    assert.equal(
      newContractValue,
      2343,
      'updated value should be higher by the percentage of DID ownership of the voter'
    )

    await didToken.issueDID(accounts[4], 2000)
    vote = 1
    // //  total DID at this point is 2000 + 2000 + 4321 == 8321 DID
    // //  so accounts[0], the voter owns 24%
    await distense.voteOnParameter(
      proposalPctDIDToApproveParameter.title,
      vote,
      {
        from: accounts[2]
      }
    )
    newContractValue = await distense.getParameterValueByTitle(
      proposalPctDIDToApproveParameter.title
    )
    assert.equal(
      newContractValue,
      2928,
      'updated value should be higher by the percentage of DID ownership of the voter'
    )
  })
})
