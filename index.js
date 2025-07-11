const userName = "cftracker";
const userPassword = "092406030124";
const connectionString =
    "mongodb+srv://cftracker:092406030124@cluster0.f7vok.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0";
const path = require("path");

const express = require("express");
const mongoose = require("mongoose");
const nodemailer = require("nodemailer");
const fetch = require("node-fetch");
const ChartJSNodeCanvas  = require("quickchart-js");
const cron = require("node-cron");
const fs = require("fs");
const readline = require("readline");

const app = express();
app.use(express.json());

let SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;
let SIX_MINUITES = 6 * 60 * 1000;
let storageFolder = path.join(__dirname, "userData");

if (!fs.existsSync(storageFolder)) {
    fs.mkdirSync(storageFolder);
}

function loadUsers() {
    const files = fs.readdirSync(storageFolder);
    return files
        .map((file) => {
            const filePath = path.join(storageFolder, file);
            const data = fs.readFileSync(filePath, "utf8").split("\n");
            const userId = data[0]?.split(": ")[1]?.trim();
            const lastSentTime = parseInt(data[1]?.split(": ")[1]?.trim()) || 0;
            return userId ? { userId, filePath, lastSentTime } : null;
        })
        .filter((user) => user !== null);
}

function addUserIfNotExists(userId) {
    const filePath = path.join(storageFolder, `${userId}.txt`);

    if (!fs.existsSync(filePath)) {
        const currentTime = Date.now();
        fs.writeFileSync(filePath, `UserId: ${userId}\nLastSent: ${currentTime}`);
        console.log(`🆕 Created file for UserId: ${userId}`);
    }
}

mongoose
    .connect(connectionString, {})
    .then(() => {
        console.log("Connected with MongoDB database successfully");
    })
    .catch((err) => {
        console.error("Failed to connect with MongoDB: ", err);
    });

mongoose.connection.on("connected", () => {
    console.log("Connected with mongodb database");
});

mongoose.connection.on("error", (err) => {
    console.error("Failed to connect with mongodb :- ", err);
});

const userProgressSchema = new mongoose.Schema(
    {
        userId: { type: String, required: true, unique: true },
        contests: [
            {
                contestId: String,
                date: String,
                problemsSolved: Number,
                problemDetails: [
                    {
                        problemIndex: String,
                        submissions: Number,
                        problemType: [String],
                        problemRating: Number,
                        submissionTime: Date,
                    },
                ],
                rank: Number,
                contestRating: Number,
                contestName: String,
            },
        ],
        practices: [
            {
                date: String,
                problemsSolved: Number,
                problemTypes: [],
                submissionCount: Number,
                problemRatings: [],
            },
        ],
        createdAt: { type: Date, default: Date.now },
    } /*,
  { collection: "UserProgress" }*/
);

const UserProgress = mongoose.model(
    "UserProgress",
    userProgressSchema /*,
  "UserProgress"*/
);

//console.log(UserProgress);

async function trackUser(userId, email) {
    try {
        console.log(userId + " fetching contest.....");

        // Fetch user contest ratings
        let ratingResponse = await fetch(
            `https://codeforces.com/api/user.rating?handle=${userId}`
        );
        let ratingData = await ratingResponse.json();

        // Fetch user submissions
        let statusResponse = await fetch(
            `https://codeforces.com/api/user.status?handle=${userId}`
        );
        let statusData = await statusResponse.json();

        console.log("status Data :- " + statusData.status + " , " + userId);
        console.log("rating data :- " + ratingData.status + " , " + userId);

        if (ratingData.status === "OK" && statusData.status === "OK") {
            let userProgress = await UserProgress.findOne({ userId });

            try {
                await UserProgress.deleteMany({ userId });
            } catch (error) {
                console.log("error at the time of delete :- " + error);
            }

            //if (!userProgress) {
            userProgress = new UserProgress({ userId });
            //}

            // Create a map of accepted problems by contestId
            let acceptedProblemsMap = {};

            let iterate = 0;

            statusData.result.forEach((submission) => {
                if (submission.verdict === "OK") {
                    let contestId = submission.contestId;
                    //console.log('contest id :- ' + contestId);
                    if (!acceptedProblemsMap[contestId]) {
                        acceptedProblemsMap[contestId] = [];
                    }
                    acceptedProblemsMap[contestId].push({
                        problemIndex: submission.problem.index,
                        submissionTime: submission.creationTimeSeconds * 1000 + "",
                        problemRating: submission.problem.rating || 0, // Problem rating (0 if not available)
                        problemType: submission.problem.tags,
                    });

                    //console.log(acceptedProblemsMap[contestId]);

                    iterate = iterate + 1;
                }
            });

            console.log("acceptable problem map :- " + iterate);

            // Fetch contest list to get start time and duration
            let contestListResponse = await fetch(
                `https://codeforces.com/api/contest.list`
            );
            const contestListData = await contestListResponse.json();

            if (contestListData.status === "OK") {
                let contestMap = {};
                contestListData.result.forEach((contest) => {
                    if (contest.startTimeSeconds && contest.durationSeconds) {
                        contestMap[contest.id] = {
                            startTime: contest.startTimeSeconds * 1000,
                            duration: contest.durationSeconds * 1000,
                            name: contest.name,
                        };
                    }
                });

                // Track contests
                for (const contest of ratingData.result) {
                    /*const problemsSolvedDetails =
                  acceptedProblemsMap[contest.contestId] || [];*/

                    let contestDetails = contestMap[contest.contestId];
                    if (contestDetails) {
                        let contestStartTime = contestDetails.startTime;
                        let contestEndTime = contestStartTime + contestDetails.duration;

                        /*console.log(
                        "contest start :- " +
                          contestStartTime +
                          " contest end time :- " +
                          contestEndTime
                      );*/

                        let problemsSolvedDetails = (
                            acceptedProblemsMap[contest.contestId] || []
                        ).filter((submission) => {
                            let submissionTime = parseInt(submission.submissionTime);
                            return (
                                submissionTime >= contestStartTime &&
                                submissionTime <= contestEndTime
                            );
                        });

                        //console.log('problem solve details :- ' + problemsSolvedDetails);

                        userProgress.contests.push({
                            contestId: contest.contestId,
                            date: contest.date * 1000 + "",
                            problemsSolved: problemsSolvedDetails.length,
                            problemDetails: problemsSolvedDetails.map((pd) => ({
                                problemIndex: pd.problemIndex,
                                submissionTime: pd.submissionTime,
                                problemRating: pd.problemRating,
                                problemType: pd.problemType,
                            })),
                            rank: contest.rank,
                            contestRating: contest.newRating,
                            contestName: contest.contestName, // Contest name
                        });
                    }

                    //console.log(userProgress.contests);
                }
            }

            //console.log("user Progress :- " + userProgress.contests);

            //await trackPractice(userId, email);

            try {
                await userProgress.save(); // Save to MongoDB

                console.log(
                    "saved " + userId + " on contest data successfully.........."
                );

                await trackPractice(userId, email);
            } catch (error) {
                console.log("error contest:- " + error);
            }
        }
    } catch (err50) {}
}

async function trackPractice(userId, email) {
    try {
        console.log(userId + " fetching practice....");

        // Fetch user submissions
        let statusResponse = await fetch(
            `https://codeforces.com/api/user.status?handle=${userId}`
        );
        let statusData = await statusResponse.json();

        console.log("practice status data :- " + statusData.status);

        if (statusData.status === "OK") {
            let submissions = statusData.result;

            // Create a map to track accepted problems and their submission counts
            let problemMap = {};

            // Process submissions
            submissions.forEach((submission) => {
                if (submission.verdict === "OK") {
                    let problem = submission.problem;
                    let problemKey = problem.index;

                    // Initialize problem entry if not present
                    if (!problemMap[problemKey]) {
                        problemMap[problemKey] = {
                            submissions: 0,
                            problemType: new Set(),
                            problemRating: [],
                        };
                    }

                    // Increment submission count for the problem
                    problemMap[problemKey].submissions += 1;
                    //problemMap[problemKey].problemRating += 1;

                    if (problem.rating) {
                        problemMap[problemKey].problemRating.push(problem.rating);
                    } else {
                        problemMap[problemKey].problemRating.push(0);
                    }

                    if (problem.tags) {
                        problemMap[problemKey].problemType.add(problem.tags);
                    } else {
                        problemMap[problemKey].problemType.add("no tags");
                    }

                    //console.log(problemKey + ' :- tags :- ' + problemMap[problemKey].problemType);
                }
            });

            //console.log("problem maps :- " + problemMap['A'].problemType);

            // Convert the map to an array
            let problemDetails = Object.entries(problemMap).map(
                ([index, details]) => ({
                    problemIndex: index,
                    submissions: details.submissions,
                    problemType: Array.from(details.problemType),
                    problemRating: details.problemRating,
                })
            );

            console.log("problem details :- " + problemDetails.length);

            if (problemDetails.length === 0) {
                console.log("No problem details collected.");
            } else {
                //console.log("Problem Details:", problemDetails);
            }

            //console.log('collected contest data :- ' + UserProgress.contests);

            let userProgress = await UserProgress.findOne({ userId });

            //console.log('userProgress :- ' + userProgress.contests);

            if (userProgress) {
                let problemRatings = problemDetails.map((pd) => pd.problemRating);
                userProgress.practices.push({
                    date: new Date() + "", // Store date in ISO format
                    problemsSolved: problemDetails.length,
                    problemTypes: [
                        ...new Set(problemDetails.map((pd) => pd.problemType)),
                    ],
                    submissionCount: submissions.length,
                    problemRatings: problemRatings,
                });

                //console.log("user progress practice :- " + userProgress);

                try {
                    await userProgress.save();

                    //console.log("user progress practice :- " + userProgress);

                    await sendReport(userId, email);

                    console.log("user contest progress saved successfully.......");

                    //await sendReport(userId, email);
                } catch (error) {
                    console.log("error practice :- " + error);
                }

                //await sendReport(userId, email);
            }
        }
    } catch (error60) {}
}

async function createCharts(userProgress, userId) {
    try {
        console.log(userId + " creating chart..........");

        //console.log(userProgress.contests);
        //console.log("practice progress in create chart :- "+ userProgress.practices);

        let width = 1000;
        let height = 1000;
        let chartJSNodeCanvas = new ChartJSNodeCanvas({ width, height });

        let contestData = userProgress.contests.map((contest) => ({
            contestName: contest.contestName,
            contestRating: contest.contestRating,
            problemsSolved: contest.problemsSolved,
            problemRatings: contest.problemDetails.map(
                (detail) => detail.problemRating
            ),
        }));

        let contestLabels = contestData.map(
            (data) => `${data.contestName} (${data.contestRating})`
        );
        let problemsSolvedData = contestData.map((data) => data.problemsSolved);

        let contestConfig = {
            type: "bar",
            data: {
                labels: contestLabels,
                datasets: [
                    {
                        label: "Problems Solved in Contest",
                        data: problemsSolvedData,
                        backgroundColor: "rgba(75, 192, 192, 0.5)",
                    },
                ],
            },
            options: {
                responsive: true,
                scales: {
                    x: { title: { display: true, text: "Contest Name (Rating)" } },
                    y: { title: { display: true, text: "Number of Problems Solved" } },
                },
            },
        };

        console.log(
            "practices report at making chart :- " + typeof userProgress.practices
        );

        let practiceData = Object.values(userProgress.practices);

        let ratingCounts = {};

        // Process problem ratings
        userProgress.practices.forEach((practice) => {
            practice.problemRatings.forEach((ratings) => {
                ratings.forEach((rating) => {
                    // Increment the count for this rating
                    if (ratingCounts[rating]) {
                        ratingCounts[rating]++;
                    } else {
                        ratingCounts[rating] = 1; // Initialize if not already present
                    }
                });
            });
        });

        // Prepare data for the line chart
        let sortedRatings = Object.keys(ratingCounts).sort((a, b) => a - b); // Sorting ratings
        let counts = sortedRatings.map((rating) => ratingCounts[rating]); // Corresponding counts

        let tagCounts = {};

        userProgress.practices.forEach((practice) => {
            // Check if problemTypes exists and is an array
            if (Array.isArray(practice.problemTypes)) {
                practice.problemTypes.forEach((tags) => {
                    // Each tags should be a string like "bitmasks, dp, greedy"
                    let tagsArray = tags
                        .toString()
                        .split(",")
                        .map((tag) => tag.trim()); // Split and trim tags

                    tagsArray.forEach((tag) => {
                        // Increment the count for this tag
                        tagCounts[tag] = (tagCounts[tag] || 0) + 1;
                    });
                });
            }
        });

        let problemTypeLabels1 = Object.keys(tagCounts);
        let problemTypeData1 = Object.values(tagCounts);

        let problemTypeConfig1 = {
            type: "bar",
            data: {
                labels: problemTypeLabels1,
                datasets: [
                    {
                        label: "Problems Type Solved in practice",
                        data: problemTypeData1,
                        backgroundColor: "rgba(75, 192, 192, 0.5)",
                    },
                ],
            },
            options: {
                responsive: true,
                scales: {
                    x: { title: { display: true, text: "Contest Name (Rating)" } },
                    y: { title: { display: true, text: "Number of Problems Solved" } },
                },
                indexAxis: "x",
            },
        };

        let practiceConfig = {
            type: "line",
            data: {
                labels: counts,
                datasets: [
                    {
                        label: "Problems rating Solved in Practice",
                        data: sortedRatings,
                        borderColor: "rgba(153, 102, 255, 1)",
                        fill: false,
                    },
                    /*{
                    label: "Total count in solved",
                    data: counts ,
                    borderColor: "rgba(255, 99, 132, 1)",
                    fill: false,
                  },*/
                ],
            },
            options: {
                responsive: true,
                scales: {
                    x: { title: { display: true, text: "How many solved" } },
                    y: { title: { display: true, text: "Ratings" } },
                },
            },
        };

        let averageRatings = contestData.map(
            (data) =>
                data.problemRatings.reduce((a, b) => a + b, 0) /
                data.problemRatings.length || 0
        );

        let averageRatingConfig = {
            type: "line",
            data: {
                labels: contestLabels,
                datasets: [
                    {
                        label: "Average Problem Rating",
                        data: averageRatings,
                        borderColor: "rgba(54, 162, 235, 1)",
                        fill: false,
                    },
                ],
            },
            options: {
                responsive: true,
                scales: {
                    x: { title: { display: true, text: "Contest Name (Rating)" } },
                    y: { title: { display: true, text: "Average Problem Rating" } },
                },
            },
        };

        let allProblemTypes = userProgress.contests.flatMap((contest) =>
            contest.problemDetails.flatMap((pd) => pd.problemType)
        );

        //console.log("all problem types :- " + allProblemTypes);

        // Count occurrences of each problem type
        let problemTypeCounts = {};
        allProblemTypes.forEach((type) => {
            problemTypeCounts[type] = (problemTypeCounts[type] || 0) + 1;
        });

        // Prepare labels and data for the pie chart
        let problemTypeLabels = Object.keys(problemTypeCounts);
        let problemTypeData = Object.values(problemTypeCounts);

        let problemTypeConfig = {
            type: "pie",
            data: {
                labels: problemTypeLabels,
                datasets: [
                    {
                        label: "Problems Solved by Type",
                        data: problemTypeData,
                        backgroundColor: problemTypeLabels.map(
                            () => `#${Math.floor(Math.random() * 16777215).toString(16)}`
                        ),
                    },
                ],
            },
            options: {
                responsive: true,
            },
        };

        let ratingCountsContest = {};
        userProgress.contests.forEach((contest) => {
            contest.problemDetails.forEach((detail) => {
                let rating = detail.problemRating;
                if (rating) {
                    ratingCountsContest[rating] = (ratingCountsContest[rating] || 0) + 1;
                }
            });
        });

        let ratingCountsPractice = {};
        userProgress.practices.forEach((practice) => {
            practice.problemRatings.forEach((rating) => {
                let ratingsArray = rating
                    .toString()
                    .split(",")
                    .map((rating) => rating.trim()); // Split and trim tags

                ratingsArray.forEach((eachRating) => {
                    // Increment the count for this tag
                    ratingCountsPractice[eachRating] =
                        (ratingCountsPractice[eachRating] || 0) + 1;
                });
            });
        });

        let ratings = Array.from(
            new Set([
                ...Object.keys(ratingCountsContest),
                ...Object.keys(ratingCountsPractice),
            ])
        );

        let contestDataByRating = ratings.map(
            (rating) => ratingCountsContest[rating] || 0
        );
        let practiceDataByRating = ratings.map(
            (rating) => ratingCountsPractice[rating] || 0
        );

        // Creating the new bar chart configuration
        let ratingComparisonConfig = {
            type: "bar",
            data: {
                labels: [...new Set(ratings)], // Ensure unique ratings
                datasets: [
                    {
                        label: "Problems Solved in Contest",
                        data: contestDataByRating,
                        backgroundColor: "rgba(75, 192, 192, 0.7)",
                        barThickness: 30, // Set a fixed bar width
                        categoryPercentage: 0.5, // Adjust to control the space between bars
                    },
                    {
                        label: "Problems Solved in Practice",
                        data: practiceDataByRating,
                        backgroundColor: "rgba(153, 102, 255, 0.7)",
                        barThickness: 30,
                        categoryPercentage: 0.5,
                    },
                ],
            },
            options: {
                responsive: true,
                scales: {
                    x: {
                        title: {
                            display: true,
                            text: "Problem Ratings",
                        },
                        ticks: {
                            autoSkip: false, // Show all x-axis labels
                            maxRotation: 0, // Keep labels horizontal
                            minRotation: 0,
                        },
                        grid: {
                            display: true, // Show grid lines for better readability
                        },
                    },
                    y: {
                        title: {
                            display: true,
                            text: "Count of Problems Solved",
                        },
                        beginAtZero: true,
                    },
                },
                plugins: {
                    legend: {
                        display: true,
                        position: "top",
                    },
                },
                barPercentage: 0.4, // Control overall bar width percentage
            },
        };

        let ratingResponse = await fetch(
            `https://codeforces.com/api/user.rating?handle=${userId}`
        );
        let ratingData = await ratingResponse.json();

        // Fetch user submissions
        let statusResponse = await fetch(
            `https://codeforces.com/api/user.status?handle=${userId}`
        );
        let statusData = await statusResponse.json();

        // Render the new rating comparison chart
        let ratingComparisonChart = await chartJSNodeCanvas.renderToBuffer(
            ratingComparisonConfig
        );

        let acceptedCountMap = {};
        let wrongCountMap = {};

        let contestIdSet = new Set();

        userProgress.contests.forEach((contest) => {
            //console.log("contestId :- " + contest.contestId);

            if (!contest.contestId || contest.contestId == undefined) {
                console.warn("Contest missing contestId:", contest);
            } else {
                try {
                    contestIdSet.add(
                        contest.contestId != undefined
                            ? contest.contestId.toString().trim()
                            : "no contest"
                    );
                } catch (e) {}
            }
        });

        console.log("participated contests id :- " + contestIdSet.size);

        /*contestIdSet.forEach((contest) => {

        console.log(contest + " " + typeof contest);

      });*/

        let contestListResponseData = await fetch(
            `https://codeforces.com/api/contest.list`
        );
        let contestListTimeData = await contestListResponseData.json();

        let contestMap = {};

        if (contestListTimeData.status === "OK") {
            //contestMap = {};
            contestListTimeData.result.forEach((contest) => {
                if (contest.startTimeSeconds && contest.durationSeconds) {
                    contestMap[contest.id + ""] = {
                        startTime: contest.startTimeSeconds * 1000,
                        duration: contest.durationSeconds * 1000,
                        name: contest.name,
                        endTime:
                            contest.startTimeSeconds * 1000 + contest.durationSeconds * 1000,
                    };
                }
            });
        }

        //console.log("const 1348 is :- ");
        //console.log(contestMap["1348"]);

        let wrongPracticeCountMap = {};
        let acceptedProblemTag = {};
        let wrongProblemTag = {};
        let onContestAcceptedProblemTag = {};
        let onContestWrongAnswerProblemTag = {};

        let currentDate = new Date();
        let currentYear = currentDate.getFullYear();
        let previousYear = currentYear - 1;

        let presentYearTagOnContest = {};
        let pastYearTagOnContest = {};
        let presentYearTagOnPractice = {};
        let pastYearTagOnPractice = {};

        let presentYearTagOnContestForWrong = {};
        let pastYearTagOnContestForWrong = {};
        let presentYearTagOnPracticeForWrong = {};
        let pastYearTagOnPracticeForWrong = {};

        let presentYearRatingOnContest = {};
        let pastYearRatingOnContest = {};
        let presentYearRatingOnPractice = {};
        let pastYearRatingOnPractice = {};

        let presentYearRatingOnContestForWrong = {};
        let pastYearRatingOnContestForWrong = {};
        let presentYearRatingOnPracticeForWrong = {};
        let pastYearRatingOnPracticeForWrong = {};

        statusData.result.forEach((submission) => {
            try {
                let contestId =
                    submission.contestId != undefined
                        ? submission.contestId.toString().trim()
                        : "No Contest";
                let rating = submission.problem.rating || 0;

                let tags = submission.problem.tags;
                let submissionTime = submission.creationTimeSeconds * 1000;

                let submissionDate = new Date(submission.creationTimeSeconds * 1000);
                let year = submissionDate.getFullYear();

                if (year == currentYear) {
                    let tagsString = Object.values(tags).join(","); // Join values into a string
                    let tagsArray = tagsString.split(",").map((tag) => tag.trim()); // Split by comma and trim whitespace

                    if (submission.verdict == "OK") {
                        tagsArray.forEach((problemTag) => {
                            presentYearTagOnPractice[problemTag] =
                                (presentYearTagOnPractice[problemTag] || 0) + 1;
                            //console.log("problem tag :- " + problemTag);
                        });

                        presentYearRatingOnPractice[rating] =
                            (presentYearRatingOnPractice[rating] || 0) + 1;
                    } else if (submission.verdict == "WRONG_ANSWER") {
                        tagsArray.forEach((problemTag) => {
                            presentYearTagOnPracticeForWrong[problemTag] =
                                (presentYearTagOnPracticeForWrong[problemTag] || 0) + 1;
                            //console.log("problem tag :- " + problemTag);
                        });

                        presentYearRatingOnPracticeForWrong[rating] =
                            (presentYearRatingOnPracticeForWrong[rating] || 0) + 1;
                    }
                } else if (year == previousYear) {
                    let tagsString = Object.values(tags).join(","); // Join values into a string
                    let tagsArray = tagsString.split(",").map((tag) => tag.trim()); // Split by comma and trim whitespace

                    if (submission.verdict == "OK") {
                        tagsArray.forEach((problemTag) => {
                            pastYearTagOnPractice[problemTag] =
                                (pastYearTagOnPractice[problemTag] || 0) + 1;
                            //console.log("problem tag :- " + problemTag);
                        });

                        pastYearRatingOnPractice[rating] =
                            (pastYearRatingOnPractice[rating] || 0) + 1;
                    } else if (submission.verdict == "WRONG_ANSWER") {
                        tagsArray.forEach((problemTag) => {
                            pastYearTagOnPracticeForWrong[problemTag] =
                                (pastYearTagOnPracticeForWrong[problemTag] || 0) + 1;
                            //console.log("problem tag :- " + problemTag);
                        });

                        pastYearRatingOnPracticeForWrong[rating] =
                            (pastYearRatingOnPracticeForWrong[rating] || 0) + 1;
                    }
                }

                let contestData = contestMap[contestId + ""] || {
                    startTime: 0,
                    endTime: 0,
                };

                let contestStartTime = contestData.startTime || 0;
                let contestEndTime = contestData.endTime || 0;

                try {
                    let tagsString = Object.values(tags).join(","); // Join values into a string
                    let tagsArray = tagsString.split(",").map((tag) => tag.trim()); // Split by comma and trim whitespace

                    //console.log('tags array :- ' + tagsArray.length);

                    if (submission.verdict == "OK") {
                        tagsArray.forEach((problemTag) => {
                            acceptedProblemTag[problemTag] =
                                (acceptedProblemTag[problemTag] || 0) + 1;
                            //console.log("problem tag :- " + problemTag);
                        });
                    } else if (submission.verdict == "WRONG_ANSWER") {
                        tagsArray.forEach((problemTag) => {
                            wrongProblemTag[problemTag] =
                                (wrongProblemTag[problemTag] || 0) + 1;
                        });
                    }
                } catch (e1) {}

                if (submission.verdict == "WRONG_ANSWER") {
                    wrongPracticeCountMap[rating] =
                        (wrongPracticeCountMap[rating] || 0) + 1;
                }

                if (
                    contestIdSet.has(contestId) &&
                    submissionTime >= contestStartTime &&
                    submissionTime <= contestEndTime
                ) {
                    let tagsString = Object.values(tags).join(","); // Join values into a string
                    let tagsArray = tagsString.split(",").map((tag) => tag.trim()); // Split by comma and trim whitespace

                    if (year == currentYear) {
                        let tagsString = Object.values(tags).join(","); // Join values into a string
                        let tagsArray = tagsString.split(",").map((tag) => tag.trim()); // Split by comma and trim whitespace

                        if (submission.verdict == "OK") {
                            tagsArray.forEach((problemTag) => {
                                presentYearTagOnContest[problemTag] =
                                    (presentYearTagOnContest[problemTag] || 0) + 1;
                                //console.log("problem tag :- " + problemTag);
                            });

                            presentYearRatingOnContest[rating] =
                                (presentYearRatingOnContest[rating] || 0) + 1;
                        } else if (submission.verdict == "WRONG_ANSWER") {
                            tagsArray.forEach((problemTag) => {
                                presentYearTagOnContestForWrong[problemTag] =
                                    (presentYearTagOnContestForWrong[problemTag] || 0) + 1;
                                //console.log("problem tag :- " + problemTag);
                            });

                            presentYearRatingOnContestForWrong[rating] =
                                (presentYearRatingOnContestForWrong[rating] || 0) + 1;
                        }
                    } else if (year == previousYear) {
                        let tagsString = Object.values(tags).join(","); // Join values into a string
                        let tagsArray = tagsString.split(",").map((tag) => tag.trim()); // Split by comma and trim whitespace

                        if (submission.verdict == "OK") {
                            tagsArray.forEach((problemTag) => {
                                pastYearTagOnContest[problemTag] =
                                    (pastYearTagOnContest[problemTag] || 0) + 1;
                                //console.log("problem tag :- " + problemTag);
                            });

                            pastYearRatingOnContest[rating] =
                                (pastYearRatingOnContest[rating] || 0) + 1;
                        } else if (submission.verdict == "WRONG_ANSWER") {
                            tagsArray.forEach((problemTag) => {
                                pastYearTagOnContestForWrong[problemTag] =
                                    (pastYearTagOnContestForWrong[problemTag] || 0) + 1;
                                //console.log("problem tag :- " + problemTag);
                            });

                            pastYearRatingOnContestForWrong[rating] =
                                (pastYearRatingOnContestForWrong[rating] || 0) + 1;
                        }
                    }

                    if (submission.verdict == "OK") {
                        tagsArray.forEach((problemTag) => {
                            onContestAcceptedProblemTag[problemTag] =
                                (onContestAcceptedProblemTag[problemTag] || 0) + 1;
                        });
                    } else if (submission.verdict == "WRONG_ANSWER") {
                        tagsArray.forEach((problemTag) => {
                            onContestWrongAnswerProblemTag[problemTag] =
                                (onContestWrongAnswerProblemTag[problemTag] || 0) + 1;
                        });
                    }

                    if (submission.verdict === "OK") {
                        acceptedCountMap[rating] = (acceptedCountMap[rating] || 0) + 1;
                    } else if (submission.verdict === "WRONG_ANSWER") {
                        wrongCountMap[rating] = (wrongCountMap[rating] || 0) + 1;

                        //console.log(rating + " :- " + wrongCountMap[rating]);
                    }
                }
            } catch (e) {
                console.log(
                    "error in on contest and on practice tag collector :- " + e
                );
            }
        });

        let ratings1 = [...new Set([...Object.keys(wrongCountMap), ...ratings])];

        let ratings2 = [...new Set([...Object.keys(wrongPracticeCountMap)])];

        let wrongCounts = ratings1.map((rating) => wrongCountMap[rating] || 0);

        let allRating = [
            ...new Set([
                ...Object.keys(presentYearRatingOnContest),
                ...Object.keys(pastYearRatingOnContest),
                ...Object.keys(presentYearRatingOnContestForWrong),
                ...Object.keys(pastYearRatingOnContestForWrong),
            ]),
        ];

        let presentYearAcceptedProblemRating = allRating.map(
            (rating) => presentYearRatingOnContest[rating] || 0
        ); // present year rating

        let pastYearAcceptedProblemRating = allRating.map(
            (rating) => pastYearRatingOnContest[rating] || 0
        ); // past year rating

        let presentYearWrongProblemRating = allRating.map(
            (rating) => presentYearRatingOnContestForWrong[rating] || 0
        ); // present year rating

        let pastYearWrongProblemRating = allRating.map(
            (rating) => pastYearRatingOnContestForWrong[rating] || 0
        ); // past year rating

        let practiceWrongCounts = ratings2.map(
            (rating) => wrongPracticeCountMap[rating] || 0
        );

        let presentYearAcceptedProblemRatingInPractice = allRating.map(
            (rating) => presentYearRatingOnPractice[rating] || 0
        ); // present year rating

        let pastYearAcceptedProblemRatingInPractice = allRating.map(
            (rating) => pastYearRatingOnPractice[rating] || 0
        ); // past year rating

        let presentYearWrongProblemRatingInPractice = allRating.map(
            (rating) => presentYearRatingOnPracticeForWrong[rating] || 0
        ); // present year rating

        let pastYearWrongProblemRatingInPractice = allRating.map(
            (rating) => pastYearRatingOnPracticeForWrong[rating] || 0
        ); // past year rating

        let problemTags = [
            ...new Set([
                ...Object.keys(onContestAcceptedProblemTag),
                ...Object.keys(acceptedProblemTag),
                ...Object.keys(onContestWrongAnswerProblemTag),
                ...Object.keys(wrongProblemTag),
            ]),
        ];

        //console.log("problem tags :- " + problemTags);

        let onContestAcceptedProblems = problemTags.map(
            (problemTag) => onContestAcceptedProblemTag[problemTag] || 0
        );

        let presentYearOnContestAcceptedProblems = problemTags.map(
            (problemTag) => presentYearTagOnContest[problemTag] || 0
        ); // for present year accepted problem tag

        let pastYearOnContestAcceptedProblems = problemTags.map(
            (problemTag) => pastYearTagOnContest[problemTag] || 0
        ); // for the past year accepted problem tag

        let onPracticeAcceptedProblems = problemTags.map(
            (problemTag) => acceptedProblemTag[problemTag] || 0
        );

        let presentYearOnPracticeAcceptedProblems = problemTags.map(
            (problemTag) => presentYearTagOnPractice[problemTag] || 0
        ); // for present year accepted problem tag

        let pastYearOnPracticeAcceptedProblems = problemTags.map(
            (problemTag) => pastYearTagOnPractice[problemTag] || 0
        ); // for the past year accepted problem tag

        let onContestWrongProblems = problemTags.map(
            (problemTag) => onContestWrongAnswerProblemTag[problemTag] || 0
        );

        let presentYearOnContestWrongProblems = problemTags.map(
            (problemTag) => presentYearTagOnContestForWrong[problemTag] || 0
        ); // for present year accepted problem tag

        let pastYearOnContestWrongProblems = problemTags.map(
            (problemTag) => pastYearTagOnContestForWrong[problemTag] || 0
        ); // for the past year wrong problem tag

        let onPracticeWrongProblems = problemTags.map(
            (problemTag) => wrongProblemTag[problemTag] || 0
        );

        let presentYearOnPracticeAcceptedProblemsForWrong = problemTags.map(
            (problemTag) => presentYearTagOnPracticeForWrong[problemTag] || 0
        ); // for present year accepted problem tag

        let pastYearOnPracticeAcceptedProblemsForWrong = problemTags.map(
            (problemTag) => pastYearTagOnPracticeForWrong[problemTag] || 0
        ); // for the past year accepted problem tag

        let submissionsComparisonConfig = {
            type: "bar",
            data: {
                labels: [...new Set(ratings1)], // Use the unique ratings
                datasets: [
                    {
                        label: "Accepted Problems",
                        data: contestDataByRating,
                        backgroundColor: "rgba(75, 192, 192, 0.7)",
                        barThickness: 30,
                        categoryPercentage: 0.5,
                    },
                    {
                        label: "Wrong Submissions",
                        data: wrongCounts,
                        backgroundColor: "rgba(255, 99, 132, 0.7)",
                        barThickness: 30,
                        categoryPercentage: 0.5,
                    },
                ],
            },
            options: {
                responsive: true,
                scales: {
                    x: {
                        title: {
                            display: true,
                            text: "Problem Ratings",
                        },
                        ticks: {
                            autoSkip: false,
                            maxRotation: 0,
                            minRotation: 0,
                        },
                    },
                    y: {
                        title: {
                            display: true,
                            text: "Count",
                        },
                        beginAtZero: true,
                    },
                },
                plugins: {
                    legend: {
                        display: true,
                        position: "top",
                    },
                },
                barPercentage: 0.4,
            },
        };

        const submissionsComparisonConfig1 = {
            type: "bar",
            data: {
                labels: [...new Set(ratings2)], // Use the unique ratings
                datasets: [
                    {
                        label: "Accepted Problems",
                        data: practiceDataByRating,
                        backgroundColor: "rgba(75, 192, 192, 0.7)",
                        barThickness: 30,
                        categoryPercentage: 0.5,
                    },
                    {
                        label: "Wrong Submissions",
                        data: practiceWrongCounts,
                        backgroundColor: "rgba(255, 99, 132, 0.7)",
                        barThickness: 30,
                        categoryPercentage: 0.5,
                    },
                ],
            },
            options: {
                responsive: true,
                scales: {
                    x: {
                        title: {
                            display: true,
                            text: "Problem Ratings",
                        },
                        ticks: {
                            autoSkip: false,
                            maxRotation: 0,
                            minRotation: 0,
                        },
                    },
                    y: {
                        title: {
                            display: true,
                            text: "Count",
                        },
                        beginAtZero: true,
                    },
                },
                plugins: {
                    legend: {
                        display: true,
                        position: "top",
                    },
                },
                barPercentage: 0.4,
            },
        };

        const submissionsComparisonConfig2 = {
            type: "bar",
            data: {
                labels: problemTags, // Use problemTags directly
                datasets: [
                    {
                        label: "Accepted Problems",
                        data: onContestAcceptedProblems,
                        backgroundColor: "rgba(75, 192, 192, 0.7)",
                        barThickness: 15,
                        categoryPercentage: 0.6,
                    },
                    {
                        label: "Wrong Submissions",
                        data: onContestWrongProblems,
                        backgroundColor: "rgba(255, 99, 132, 0.7)",
                        barThickness: 15,
                        categoryPercentage: 0.6,
                    },
                ],
            },
            options: {
                responsive: true,
                scales: {
                    x: {
                        title: {
                            display: true,
                            text: "Problem Tags", // Change the title to "Problem Tags"
                        },
                        ticks: {
                            autoSkip: false,
                            maxRotation: 45, // Allow for rotation of labels for better visibility
                            minRotation: 45,
                        },
                    },
                    y: {
                        title: {
                            display: true,
                            text: "Count",
                        },
                        beginAtZero: true,
                    },
                },
                plugins: {
                    legend: {
                        display: true,
                        position: "top",
                    },
                },
                barPercentage: 0.5,
            },
        };

        const submissionsComparisonConfig3 = {
            type: "bar",
            data: {
                labels: problemTags, // Use problemTags directly
                datasets: [
                    {
                        label: "Accepted Problems",
                        data: onPracticeAcceptedProblems,
                        backgroundColor: "rgba(75, 192, 192, 0.7)",
                        barThickness: 15,
                        categoryPercentage: 0.6,
                    },
                    {
                        label: "Wrong Submissions",
                        data: onPracticeWrongProblems,
                        backgroundColor: "rgba(255, 99, 132, 0.7)",
                        barThickness: 15,
                        categoryPercentage: 0.6,
                    },
                ],
            },
            options: {
                responsive: true,
                scales: {
                    x: {
                        title: {
                            display: true,
                            text: "Problem Tags", // Change the title to "Problem Tags"
                        },
                        ticks: {
                            autoSkip: false,
                            maxRotation: 45, // Allow for rotation of labels for better visibility
                            minRotation: 45,
                        },
                    },
                    y: {
                        title: {
                            display: true,
                            text: "Count",
                        },
                        beginAtZero: true,
                    },
                },
                plugins: {
                    legend: {
                        display: true,
                        position: "top",
                    },
                },
                barPercentage: 0.5,
            },
        };

        const submissionsComparisonConfig4 = {
            type: "bar",
            data: {
                labels: problemTags, // Use problemTags directly
                datasets: [
                    {
                        label: "Accepted Problems for " + currentYear,
                        data: presentYearOnContestAcceptedProblems,
                        backgroundColor: "rgba(75, 192, 192, 0.7)",
                        barThickness: 15,
                        categoryPercentage: 0.6,
                    },
                    {
                        label: "Wrong Submissions for " + currentYear,
                        data: presentYearOnContestWrongProblems,
                        backgroundColor: "rgba(255, 99, 132, 0.7)",
                        barThickness: 15,
                        categoryPercentage: 0.6,
                    },
                ],
            },
            options: {
                responsive: true,
                scales: {
                    x: {
                        title: {
                            display: true,
                            text: "Problem Tags", // Change the title to "Problem Tags"
                        },
                        ticks: {
                            autoSkip: false,
                            maxRotation: 45, // Allow for rotation of labels for better visibility
                            minRotation: 45,
                        },
                    },
                    y: {
                        title: {
                            display: true,
                            text: "Count",
                        },
                        beginAtZero: true,
                    },
                },
                plugins: {
                    legend: {
                        display: true,
                        position: "top",
                    },
                },
                barPercentage: 0.5,
            },
        };

        const submissionsComparisonConfig5 = {
            type: "bar",
            data: {
                labels: problemTags, // Use problemTags directly
                datasets: [
                    {
                        label: "Accepted Problems for " + previousYear,
                        data: pastYearOnContestAcceptedProblems,
                        backgroundColor: "rgba(75, 192, 192, 0.7)",
                        barThickness: 15,
                        categoryPercentage: 0.6,
                    },
                    {
                        label: "Wrong Submissions for " + previousYear,
                        data: pastYearOnContestWrongProblems,
                        backgroundColor: "rgba(255, 99, 132, 0.7)",
                        barThickness: 15,
                        categoryPercentage: 0.6,
                    },
                ],
            },
            options: {
                responsive: true,
                scales: {
                    x: {
                        title: {
                            display: true,
                            text: "Problem Tags", // Change the title to "Problem Tags"
                        },
                        ticks: {
                            autoSkip: false,
                            maxRotation: 45, // Allow for rotation of labels for better visibility
                            minRotation: 45,
                        },
                    },
                    y: {
                        title: {
                            display: true,
                            text: "Count",
                        },
                        beginAtZero: true,
                    },
                },
                plugins: {
                    legend: {
                        display: true,
                        position: "top",
                    },
                },
                barPercentage: 0.5,
            },
        };

        const submissionsComparisonConfig6 = {
            type: "bar",
            data: {
                labels: allRating, // Use problemTags directly
                datasets: [
                    {
                        label: "Accepted Problems for " + currentYear,
                        data: presentYearAcceptedProblemRating,
                        backgroundColor: "rgba(75, 192, 192, 0.7)",
                        barThickness: 15,
                        categoryPercentage: 0.6,
                    },
                    {
                        label: "Wrong Submissions for " + currentYear,
                        data: presentYearWrongProblemRating,
                        backgroundColor: "rgba(255, 99, 132, 0.7)",
                        barThickness: 15,
                        categoryPercentage: 0.6,
                    },
                ],
            },
            options: {
                responsive: true,
                scales: {
                    x: {
                        title: {
                            display: true,
                            text: "Problem Tags", // Change the title to "Problem Tags"
                        },
                        ticks: {
                            autoSkip: false,
                            maxRotation: 45, // Allow for rotation of labels for better visibility
                            minRotation: 45,
                        },
                    },
                    y: {
                        title: {
                            display: true,
                            text: "Count",
                        },
                        beginAtZero: true,
                    },
                },
                plugins: {
                    legend: {
                        display: true,
                        position: "top",
                    },
                },
                barPercentage: 0.5,
            },
        };

        const submissionsComparisonConfig7 = {
            type: "bar",
            data: {
                labels: allRating, // Use problemTags directly
                datasets: [
                    {
                        label: "Accepted Problems for " + previousYear,
                        data: pastYearAcceptedProblemRating,
                        backgroundColor: "rgba(75, 192, 192, 0.7)",
                        barThickness: 15,
                        categoryPercentage: 0.6,
                    },
                    {
                        label: "Wrong Submissions for " + previousYear,
                        data: pastYearWrongProblemRating,
                        backgroundColor: "rgba(255, 99, 132, 0.7)",
                        barThickness: 15,
                        categoryPercentage: 0.6,
                    },
                ],
            },
            options: {
                responsive: true,
                scales: {
                    x: {
                        title: {
                            display: true,
                            text: "Problem Tags", // Change the title to "Problem Tags"
                        },
                        ticks: {
                            autoSkip: false,
                            maxRotation: 45, // Allow for rotation of labels for better visibility
                            minRotation: 45,
                        },
                    },
                    y: {
                        title: {
                            display: true,
                            text: "Count",
                        },
                        beginAtZero: true,
                    },
                },
                plugins: {
                    legend: {
                        display: true,
                        position: "top",
                    },
                },
                barPercentage: 0.5,
            },
        };

        const submissionsComparisonConfig8 = {
            type: "bar",
            data: {
                labels: allRating, // Use problemTags directly
                datasets: [
                    {
                        label: "Accepted Problems for " + currentYear,
                        data: presentYearAcceptedProblemRatingInPractice,
                        backgroundColor: "rgba(75, 192, 192, 0.7)",
                        barThickness: 15,
                        categoryPercentage: 0.6,
                    },
                    {
                        label: "Wrong Submissions for " + currentYear,
                        data: presentYearWrongProblemRatingInPractice,
                        backgroundColor: "rgba(255, 99, 132, 0.7)",
                        barThickness: 15,
                        categoryPercentage: 0.6,
                    },
                ],
            },
            options: {
                responsive: true,
                scales: {
                    x: {
                        title: {
                            display: true,
                            text: "Problem Tags", // Change the title to "Problem Tags"
                        },
                        ticks: {
                            autoSkip: false,
                            maxRotation: 45, // Allow for rotation of labels for better visibility
                            minRotation: 45,
                        },
                    },
                    y: {
                        title: {
                            display: true,
                            text: "Count",
                        },
                        beginAtZero: true,
                    },
                },
                plugins: {
                    legend: {
                        display: true,
                        position: "top",
                    },
                },
                barPercentage: 0.5,
            },
        };

        const submissionsComparisonConfig9 = {
            type: "bar",
            data: {
                labels: allRating, // Use problemTags directly
                datasets: [
                    {
                        label: "Accepted Problems for " + previousYear,
                        data: pastYearAcceptedProblemRatingInPractice,
                        backgroundColor: "rgba(75, 192, 192, 0.7)",
                        barThickness: 15,
                        categoryPercentage: 0.6,
                    },
                    {
                        label: "Wrong Submissions for " + previousYear,
                        data: pastYearWrongProblemRatingInPractice,
                        backgroundColor: "rgba(255, 99, 132, 0.7)",
                        barThickness: 15,
                        categoryPercentage: 0.6,
                    },
                ],
            },
            options: {
                responsive: true,
                scales: {
                    x: {
                        title: {
                            display: true,
                            text: "Problem Tags", // Change the title to "Problem Tags"
                        },
                        ticks: {
                            autoSkip: false,
                            maxRotation: 45, // Allow for rotation of labels for better visibility
                            minRotation: 45,
                        },
                    },
                    y: {
                        title: {
                            display: true,
                            text: "Count",
                        },
                        beginAtZero: true,
                    },
                },
                plugins: {
                    legend: {
                        display: true,
                        position: "top",
                    },
                },
                barPercentage: 0.5,
            },
        };

        const submissionsComparisonConfig10 = {
            type: "bar",
            data: {
                labels: allRating, // Use problemTags directly
                datasets: [
                    {
                        label: "Accepted Problems for " + currentYear,
                        data: presentYearOnPracticeAcceptedProblems,
                        backgroundColor: "rgba(75, 192, 192, 0.7)",
                        barThickness: 15,
                        categoryPercentage: 0.6,
                    },
                    {
                        label: "Wrong Submissions for " + currentYear,
                        data: presentYearOnPracticeAcceptedProblemsForWrong,
                        backgroundColor: "rgba(255, 99, 132, 0.7)",
                        barThickness: 15,
                        categoryPercentage: 0.6,
                    },
                ],
            },
            options: {
                responsive: true,
                scales: {
                    x: {
                        title: {
                            display: true,
                            text: "Problem Tags", // Change the title to "Problem Tags"
                        },
                        ticks: {
                            autoSkip: false,
                            maxRotation: 45, // Allow for rotation of labels for better visibility
                            minRotation: 45,
                        },
                    },
                    y: {
                        title: {
                            display: true,
                            text: "Count",
                        },
                        beginAtZero: true,
                    },
                },
                plugins: {
                    legend: {
                        display: true,
                        position: "top",
                    },
                },
                barPercentage: 0.5,
            },
        };

        const submissionsComparisonConfig11 = {
            type: "bar",
            data: {
                labels: problemTags, // Use problemTags directly
                datasets: [
                    {
                        label: "Accepted Problems for " + previousYear,
                        data: pastYearOnPracticeAcceptedProblems,
                        backgroundColor: "rgba(75, 192, 192, 0.7)",
                        barThickness: 15,
                        categoryPercentage: 0.6,
                    },
                    {
                        label: "Wrong Submissions for " + previousYear,
                        data: pastYearOnPracticeAcceptedProblemsForWrong,
                        backgroundColor: "rgba(255, 99, 132, 0.7)",
                        barThickness: 15,
                        categoryPercentage: 0.6,
                    },
                ],
            },
            options: {
                responsive: true,
                scales: {
                    x: {
                        title: {
                            display: true,
                            text: "Problem Tags", // Change the title to "Problem Tags"
                        },
                        ticks: {
                            autoSkip: false,
                            maxRotation: 45, // Allow for rotation of labels for better visibility
                            minRotation: 45,
                        },
                    },
                    y: {
                        title: {
                            display: true,
                            text: "Count",
                        },
                        beginAtZero: true,
                    },
                },
                plugins: {
                    legend: {
                        display: true,
                        position: "top",
                    },
                },
                barPercentage: 0.5,
            },
        };

        const contestChart = await chartJSNodeCanvas.renderToBuffer(contestConfig);
        const practiceChart = await chartJSNodeCanvas.renderToBuffer(
            practiceConfig
        );
        const averageRatingChart = await chartJSNodeCanvas.renderToBuffer(
            averageRatingConfig
        );
        const problemTypeChart = await chartJSNodeCanvas.renderToBuffer(
            problemTypeConfig
        );

        const problemTypeChart1 = await chartJSNodeCanvas.renderToBuffer(
            problemTypeConfig1
        );

        const submissionsComparisonChart = await chartJSNodeCanvas.renderToBuffer(
            submissionsComparisonConfig
        );

        const submissionsComparisonChart1 = await chartJSNodeCanvas.renderToBuffer(
            submissionsComparisonConfig1
        );

        const submissionsComparisonChart2 = await chartJSNodeCanvas.renderToBuffer(
            submissionsComparisonConfig2
        );

        const submissionsComparisonChart3 = await chartJSNodeCanvas.renderToBuffer(
            submissionsComparisonConfig3
        );

        const submissionsComparisonChart4 = await chartJSNodeCanvas.renderToBuffer(
            submissionsComparisonConfig4
        );

        const submissionsComparisonChart5 = await chartJSNodeCanvas.renderToBuffer(
            submissionsComparisonConfig5
        );

        const submissionsComparisonChart6 = await chartJSNodeCanvas.renderToBuffer(
            submissionsComparisonConfig6
        );

        const submissionsComparisonChart7 = await chartJSNodeCanvas.renderToBuffer(
            submissionsComparisonConfig7
        );

        const submissionsComparisonChart8 = await chartJSNodeCanvas.renderToBuffer(
            submissionsComparisonConfig8
        );

        const submissionsComparisonChart9 = await chartJSNodeCanvas.renderToBuffer(
            submissionsComparisonConfig9
        );

        const submissionsComparisonChart10 = await chartJSNodeCanvas.renderToBuffer(
            submissionsComparisonConfig10
        );

        const submissionsComparisonChart11 = await chartJSNodeCanvas.renderToBuffer(
            submissionsComparisonConfig11
        );

        return {
            contestChart,
            practiceChart,
            averageRatingChart,
            problemTypeChart,
            problemTypeChart1,
            ratingComparisonChart,
            submissionsComparisonChart,
            submissionsComparisonChart1,
            submissionsComparisonChart2,
            submissionsComparisonChart3,
            submissionsComparisonChart4,
            submissionsComparisonChart5,
            submissionsComparisonChart6,
            submissionsComparisonChart7,
            submissionsComparisonChart8,
            submissionsComparisonChart9,
            submissionsComparisonChart10,
            submissionsComparisonChart11,
        };
    } catch (error40) {}
}

// Report sending function
async function sendReport(userId, email) {
    try {
        console.log(userId + " sending email...........");

        const userProgress = await UserProgress.findOne({ userId });

        //console.log("user practice progress data :- " + userProgress.practices);

        const {
            contestChart,
            practiceChart,
            averageRatingChart,
            problemTypeChart,
            problemTypeChart1,
            ratingComparisonChart,
            submissionsComparisonChart,
            submissionsComparisonChart1,
            submissionsComparisonChart2,
            submissionsComparisonChart3,
            submissionsComparisonChart4,
            submissionsComparisonChart5,
            submissionsComparisonChart6,
            submissionsComparisonChart7,
            submissionsComparisonChart8,
            submissionsComparisonChart9,
            submissionsComparisonChart10,
            submissionsComparisonChart11,
        } = await createCharts(userProgress, userId);

        const transporter = nodemailer.createTransport({
            host: "smtp-relay.brevo.com",
            port: 587,
            auth: {
                user: "89576e001@smtp-brevo.com", // Your Brevo email
                pass: "tzUTO3JFH0G1SEgp", // Your Brevo SMTP password or API key
            },
        });

        // Fetch user submissions to get solved problems
        const statusResponse = await fetch(
            `https://codeforces.com/api/user.status?handle=${userId}`
        );
        const statusData = await statusResponse.json();

        if (statusData.status !== "OK") {
            console.log("User not found");
        }

        // Track tags and ratings for solved problems
        const tagRatings = {};
        const solvedProblems = new Set();

        // Process submissions to gather ratings and tags
        statusData.result.forEach((submission) => {
            if (submission.verdict === "OK") {
                const { problem } = submission;
                const rating = problem.rating || 0;
                const problemId = `${problem.contestId}-${problem.index}`;
                solvedProblems.add(problemId);

                problem.tags.forEach((tag) => {
                    if (!tagRatings[tag]) {
                        tagRatings[tag] = { totalRating: 0, count: 0 };
                    }
                    tagRatings[tag].totalRating += rating;
                    tagRatings[tag].count += 1;
                });
            }
        });

        // Prepare average ratings for each tag
        const averageRatings = Object.fromEntries(
            Object.entries(tagRatings).map(([tag, data]) => [
                tag,
                data.totalRating / data.count,
            ])
        );

        // Fetch the latest problems from Codeforces
        const problemsResponse = await fetch(
            `https://codeforces.com/api/problemset.problems`
        );
        const problemsData = await problemsResponse.json();

        if (problemsData.status !== "OK") {
            console.log("Failed to fetch problems");
            return;
        }

        // Get the latest problems, assuming `rating` is present
        const latestProblems = problemsData.result.problems.filter(
            (problem) => problem.rating
        );

        // Create suggestions based on average ratings
        const suggestions = {};
        for (const [tag, tagAverageRating] of Object.entries(averageRatings)) {
            const filteredProblem = latestProblems
                .filter(
                    (problem) =>
                        problem.tags.includes(tag) &&
                        problem.rating >= tagAverageRating - 200 &&
                        problem.rating <= tagAverageRating + 200 &&
                        !solvedProblems.has(`${problem.contestId}-${problem.index}`)
                )
                .slice(0, 5);

            if (filteredProblem.length > 0) {
                suggestions[tag] = filteredProblem.map(
                    (problem, index) =>
                        //name: problem.name,
                        `${index + 1}. [${
                            problem.name
                        }](https://codeforces.com/problemset/problem/${problem.contestId}/${
                            problem.index
                        })`
                    //rating: problem.rating,
                ); // Limit to 5 suggestions
            }
        }

        const mailOptions = {
            from: "shohoj@bijoy2.shop",
            to: email,
            cc: "okibmdn@gmail.com",
            bcc: "arponamitroy012@gmail.com",
            subject: `Progress Report for ${userId}`,
            text:
                "Dear Student,Thank for practicing the problems. We appreciate your dedication. We want to give you a suggestion problem set so that you can take yourself in a upgrade level.The list is given bellow," +
                "Attached are your progress report charts. " +
                "\n" +
                "Problem practice suggestion :- " +
                JSON.stringify(suggestions, null, 2) +
                "\n",
            attachments: [
                /*{
                filename: "contest-progress-chart.png",
                content: contestChart,
                cid: "contestChart",
              },*/
                {
                    filename: "practice-progress-chart.png",
                    content: practiceChart,
                    cid: "practiceChart",
                },
                /*{
                filename: "average-rating-chart.png",
                content: averageRatingChart,
                cid: "averageRatingChart",
              },*/
                {
                    filename: "problems-solved-by-type.png",
                    content: problemTypeChart,
                    cid: "problemTypeChart",
                },
                /*{
                filename: "problems-solved-by-type-in-practice.png",
                content: problemTypeChart1,
                cid: "problemTypeChart1",
              },*/
                /*{
                filename: "problems-solved-by-rating-in-contest-and-practice.png",
                content: ratingComparisonChart,
                cid: "ratingComparisonChart",
              },*/
                /*{
                filename: "submission-comparison-chart.png",
                content: submissionsComparisonChart,
                cid: "submissionsComparisonChart",
              },*/
                /*{
                filename: "submission-comparison-practice-chart.png",
                content: submissionsComparisonChart1,
                cid: "submissionsComparisonChart1",
              },*/
                /*{
                filename: "submission-comparison-by-problemTags-on-contest-chart.png",
                content: submissionsComparisonChart2,
                cid: "submissionsComparisonChart2",
              },*/
                /*{
                filename: "submission-comparison-by-problemTags-on-practice-chart.png",
                content: submissionsComparisonChart3,
                cid: "submissionsComparisonChart3",
              },*/
                /*{
                filename:
                  "submission-comparison-by-problemTags-on-contest-chart-for-present-year.png",
                content: submissionsComparisonChart4,
                cid: "submissionsComparisonChart4",
              },*/
                /*{
                filename:
                  "submission-comparison-by-problemTags-on-contest-chart-for-past-year.png",
                content: submissionsComparisonChart5,
                cid: "submissionsComparisonChart5",
              },*/
                /*{
                filename:
                  "submission-comparison-by-problemRatings-on-contest-chart-for-present-year.png",
                content: submissionsComparisonChart6,
                cid: "submissionsComparisonChart6",
              },*/
                /*{
                filename:
                  "submission-comparison-by-problemRatings-on-contest-chart-for-past-year.png",
                content: submissionsComparisonChart7,
                cid: "submissionsComparisonChart7",
              },*/
                /*{
                filename:
                  "submission-comparison-by-problemRatings-on-practice-chart-for-present-year.png",
                content: submissionsComparisonChart8,
                cid: "submissionsComparisonChart8",
              },*/
                /*{
                filename:
                  "submission-comparison-by-problemRatings-on-practice-chart-for-past-year.png",
                content: submissionsComparisonChart9,
                cid: "submissionsComparisonChart9",
              },*/
                /*{
                filename:
                  "submission-comparison-by-problemTags-on-practice-chart-for-present-year.png",
                content: submissionsComparisonChart10,
                cid: "submissionsComparisonChart10",
              },*/
                /*{
                filename:
                  "submission-comparison-by-problemTags-on-practice-chart-for-past-year.png",
                content: submissionsComparisonChart11,
                cid: "submissionsComparisonChart11",
              },*/
            ],
        };

        transporter.sendMail(mailOptions, (error, info) => {
            if (error) {
                console.log("sending mail error ;- " + error);
            } else {
                console.log(
                    "Email sent: " + info.response + " , mail adress :- " + email
                );

                fs.writeFileSync(
                    "userData/" + userId + ".txt",
                    `UserId: ${userId}\nLastSent: ${Date.now()}`
                );
            }
        });
    } catch (error67) {}
}

async function findUsers() {
    const filePath = "cf data.txt";

    const fileStream = fs.createReadStream(filePath);

    const rl = readline.createInterface({
        input: fileStream,
        crlfDelay: Infinity,
    });

    let userData = [];
    let tempData = {};

    let lineCount = 0;

    for await (const line of rl) {
        if (lineCount % 2 === 0) {
            tempData.email = line.trim();
        } else {
            tempData.handle = line.trim();
            userData.push({ ...tempData });
            tempData = {};
        }
        lineCount++;
    }

    userData.forEach((user) => {
        addUserIfNotExists(user.handle);
    });

    let users = loadUsers();

    for (let i = 0; i < users.length; ++i) {
        const user = userData[i];

        const currentTime = Date.now();

        let diff = (currentTime - users[i].lastSentTime) / 1000 / 60;

        //console.log("difference :- " + diff);

        /*fs.writeFileSync(
            "userData/" + user.handle + ".txt",
            `UserId: ${user.handle}\nLastSent: ${currentTime}`
          );


        users[i].lastSentTime = Date.now();*/

        try {
            if (currentTime - users[i].lastSentTime >= SEVEN_DAYS) {
                //users[i].lastSentTime -= SEVEN_DAYS * 2;

                //setInterval(() => {
                trackUser(user.handle, user.email);
                //}, 10000);

                fs.writeFileSync(
                    "userData/" + user.handle + ".txt",
                    `UserId: ${user.handle}\nLastSent: ${currentTime}`
                );
                //console.log(`✅ Data sent to ${user.handle}`);
            } else {
                try {
                    console.log(
                        `⏳ Data NOT sent to ${user.handle}, waiting for 7 days. have to wait you ` +
                        currentTime +
                        " to " +
                        (users[i].lastSentTime + SEVEN_DAYS)
                    );
                } catch (errorMessage) {
                    console.log(errorMessage);
                }
            }
        } catch (e) {
            console.log(e);
        }
    }
}

//0 20 * * *
//*/20 * * * * *
//*/30 * * * * *
//*/50 * * * * *
//*/90 * * * * *
//*/300 * * * * *
//*/900 * * * * *
//0 0 * * 7
//0 0 */7 * *

app.get("/ping", (req, res) => {
    res.send("Ping received. Server is awake!");
});

// ক্রন কাজ সেট আপ করা হচ্ছে
cron.schedule(
    "0 20 * * *",
    async () => {
        console.log("Running the job");

        try {
            findUsers();

            // প্রতি দিন রাত 8 টায়
            /*const userId = "amit_roy"; // নির্দিষ্ট ব্যবহারকারীর ID
          const email = "arponamitroy012@gmail.com"; // প্রাপকের ইমেইল

          console.log("tracking contest.......");

           trackUser(userId, email);*/ // ব্যবহারকারীর প্রতিযোগিতা ট্র্যাক করা হচ্ছে

            //console.log("tracking practice.......");

            //await trackPractice(userId, email); // ব্যবহারকারীর অনুশীলন ট্র্যাক করা হচ্ছে

            //console.log("sending report..........");

            //await sendReport(userId, email); // রিপোর্ট পাঠানো হচ্ছে
        } catch (error) {
            console.log("main error :- " + error);
        }
    },
    {
        timezone: "Asia/Dhaka", // নিশ্চিত করো টাইমজোনটা দেওয়া আছে
    }
);

// সার্ভার শুরু করা হচ্ছে
app.listen(3000, () => {
    console.log("Server is running on port 3000"); // সার্ভার শুরু হলে লগ করা হচ্ছে
    //findUsers();
});
