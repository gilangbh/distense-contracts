pragma solidity ^0.4.17;

import './DIDToken.sol';
import './Debuggable.sol';
import './Distense.sol';
import './lib/SafeMath.sol';


contract Tasks is Approvable, Debuggable {

    using SafeMath for uint256;

    address public DIDTokenAddress;
    address public DistenseAddress;
    address public PullRequestsAddress;

    bytes32[] public taskIds;

    enum RewardStatus {TENTATIVE, DETERMINED, PAID}

    struct Task {
        string title;
        address createdBy;
        uint256 reward;
        RewardStatus rewardStatus;
        uint256 pctDIDVoted;
        uint64 numVotes;
        mapping(address => bool) rewardVotes;
    }

    mapping(bytes32 => Task) tasks;

    event LogAddTask(bytes32 taskId, string title);
    event LogTaskRewardVote(bytes32 taskId, uint256 reward, uint256 pctDIDVoted);
    event LogTaskRewardDetermined(bytes32 taskId, uint256 reward);

    function Tasks(address _DIDTokenAddress, address _DistenseAddress) public {
        DIDTokenAddress = _DIDTokenAddress;
        DistenseAddress = _DistenseAddress;
    }

    function addTask(bytes32 _taskId, string _title) external hasEnoughDIDToAddTask() returns
    (bool) {

        Distense distense = Distense(DistenseAddress);

        tasks[_taskId].createdBy = msg.sender;
        tasks[_taskId].title = _title;
        tasks[_taskId].reward = distense.getParameterValueByTitle(distense.defaultRewardParameterTitle());
        tasks[_taskId].rewardStatus = RewardStatus.TENTATIVE;

        taskIds.push(_taskId);
        LogAddTask(_taskId, _title);

        return true;

    }

    function getTaskById(bytes32 _taskId) external view returns (
        string,
        address,
        uint256,
        Tasks.RewardStatus,
        uint256,
        uint64
    ) {

        Task memory task = tasks[_taskId];
        return (
            task.title,
            task.createdBy,
            task.reward,
            task.rewardStatus,
            task.pctDIDVoted,
            task.numVotes
        );

    }

    function taskExists(bytes32 _taskId) external view returns (bool) {
        return tasks[_taskId].createdBy != 0;
    }

    function getNumTasks() external view returns (uint256) {
        return taskIds.length;
    }

    function taskRewardVote(bytes32 _taskId, uint256 _reward) external returns (bool) {

        DIDToken didToken = DIDToken(DIDTokenAddress);
        uint256 balance = didToken.balances(msg.sender);
        Distense distense = Distense(DistenseAddress);

        Task storage task = tasks[_taskId];

        require(_reward >= 0);

        //  Essentially refund the remaining gas if user's vote will have no effect
        require(task.reward != _reward);

        require(task.rewardStatus != RewardStatus.DETERMINED);

        //  Has the voter already voted on this task?
        require(!task.rewardVotes[msg.sender]);

        //  Does the voter own at least as many DID as the reward their voting for?
        //  This ensures new contributors don't have too much sway over the issuance of new DID.
        require(balance > distense.getParameterValueByTitle(distense.numDIDRequiredToTaskRewardVoteParameterTitle()));

        //  Require the reward to be less than or equal to the maximum reward parameter,
        //  which basically is a hard, floating limit on the number of DID that can be issued for any single task
        require(_reward <= distense.getParameterValueByTitle(distense.maxRewardParameterTitle()));

        task.rewardVotes[msg.sender] = true;

        uint256 pctDIDOwned = didToken.pctDIDOwned(msg.sender);
        task.pctDIDVoted = task.pctDIDVoted + pctDIDOwned;

        uint256 difference;
        uint256 update;
        if (_reward > task.reward) {
            difference = SafeMath.sub(_reward, task.reward);
            update = (pctDIDOwned * difference) / 10000;
            task.reward += update;
        } else {
            difference = SafeMath.sub(task.reward, _reward);
            update = (pctDIDOwned * difference) / 10000;
            task.reward -= update;
        }

        task.numVotes++;

        uint256 pctDIDVotedThreshold = distense.getParameterValueByTitle(
            distense.proposalPctDIDToApproveParameterTitle()
        );

        uint256 minNumVoters = distense.getParameterValueByTitle(
            distense.minNumberOfTaskRewardVotersParameterTitle()
        );

        if (task.pctDIDVoted > pctDIDVotedThreshold || task.numVotes > minNumVoters) {
            LogTaskRewardDetermined(_taskId, task.reward);
            task.rewardStatus = RewardStatus.DETERMINED;
        }

        return true;

    }

    function getTaskReward(bytes32 _taskId) external view returns (uint256) {
        return tasks[_taskId].reward;
    }

    function getTaskRewardAndStatus(bytes32 _taskId) external view returns (uint256, RewardStatus) {
        return (
            tasks[_taskId].reward,
            tasks[_taskId].rewardStatus
        );
    }

    function setTaskRewardPaid(bytes32 _taskId) external onlyApproved returns (RewardStatus) {
        tasks[_taskId].rewardStatus = RewardStatus.PAID;
        return tasks[_taskId].rewardStatus;
    }

    function getIndexOfTaskId(bytes32 _taskId) public returns (uint256) {
        uint256 numTaskIds = taskIds.length;
        if (numTaskIds > 0) {
            uint256 i = numTaskIds - 1;
            while (taskIds[i] != _taskId && i >= 0) {
                i--;
                if (i == 0)
                    if (taskIds[i] != _taskId) // save some global electricity by nesting this condition
                        return numTaskIds + 1;
            }
            return i;
        } else return numTaskIds + 1;

    }

    //  Allow deleting of paid taskIds to minimize blockchain query time on client
    //  taskIds are memorialized in the form of events/logs, so this doesn't delete them really,
    //  it just prevents them from slowing down query times
    function deleteTaskId(bytes32 _taskId) external onlyApproved returns (bool) {
        Task memory task = tasks[_taskId];

        if (task.rewardStatus == RewardStatus.PAID) {
            uint256 index = getIndexOfTaskId(_taskId);
            uint256 originalLength = taskIds.length;
            if (index <= originalLength) {
                delete taskIds[index];
                bytes32 tempTaskId = taskIds[originalLength - 1];
                taskIds[index] = tempTaskId;
                delete taskIds[originalLength - 1];
                taskIds.length = originalLength - 1;
                return true;
            }
        }
        return false;
    }

    modifier hasEnoughDIDToAddTask() {
        DIDToken didToken = DIDToken(DIDTokenAddress);
        uint256 balance = didToken.balances(msg.sender);

        Distense distense = Distense(DistenseAddress);
        uint256 numDIDRequiredToAddTask = distense.getParameterValueByTitle(distense.numDIDRequiredToTaskRewardVoteParameterTitle());
        numDIDRequiredToAddTask = SafeMath.div(numDIDRequiredToAddTask, 100);
        require(balance >= numDIDRequiredToAddTask);
        _;
    }


}
