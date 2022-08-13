// Review: Move comments like these to a README.md file
//npm init -y
//npm i express
//For parsing
//npm i cors
// npm i body-parser
//For firebase
//npm i firebase --save
//npm i firebase-admin --save
//npm i firestore --save
//For slack
// npm i @slack/bolt
//in package.json "start" : "node index.js"
//.env
//npm i dotenv

const { App } = require("@slack/bolt");
const admin = require("firebase-admin");
const serviceAccount = require("./ServiceAccountKey.json");
const http = require("http");
require("dotenv").config();
const webdriver = require('selenium-webdriver');
require('chromedriver');
const chrome = require('selenium-webdriver/chrome');



const port = process.env.PORT || 3000;

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: "https://MakersWordle-default-rtdb.firebaseio.com",
});
const db = admin.firestore();

const app = new App({
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  token: process.env.SLACK_BOT_USER_OAUTH_TOKEN,
});

const penaltyScore = "10";
let oldTS= "";

async function publishMessage(id, text) {
  try {
    await app.client.chat.postMessage({
      token: process.env.SLACK_BOT_USER_OAUTH_TOKEN,
      channel: id,
      text: text,
    });
  } catch (error) {
    console.error(error);
  }
}

function letterleMessage(msgEvent) {
  publishMessage(
    msgEvent.channel,
    "I am not allowed to delete letterle messages :(. but i can say that this is not an enjoyable gaming experience."
  );
}

async function getUser(userID) {
  const userDoc = db.collection("Users").doc(userID);
  return await userDoc.get();
}

async function newDay(today){
  const oldDateDoc = await db.collection("rememberVars").doc("Date").get();
  const oldDate = oldDateDoc.data().str;

  return today.toDateString() != oldDate; // new day reset data to max
}

async function findWinners(){
  let i = 1;
  let lowScore = 0;
  let found = false;
  let winners = {};
  const maxScore = 6;


  while (i <= maxScore && !found){
    winners = await db.collection("Users").where('TodaysScore', '==', i).get();
    if (!winners.empty){ //when lowest score is found, exit with winners and lowscore
      found = true;
      lowScore = i;
    }
    i++;
  }
  return {Winners: winners, Found:found, LowScore:lowScore}
}

async function winnerOfTheDayMessage(sendDate){
  // Channel you want to post the message to
  const channelId = "C0358QRMRBP";
  let message = "Congratulations ";

  const winnersJSON = await findWinners();

  const winners = winnersJSON.Winners;
  const found = winnersJSON.Found;
  const lowScore = winnersJSON.LowScore;

  if (!found){ //if not found, exit function
    return;
  }

  winners.forEach((doc) => { //create message
    message = `${message}${doc.data().Name}, `;
  });

  message = `${message.substring(0,message.length-2)} for getting the best score of the day with a score of: ${lowScore}!`;


  sendDate.setHours(sendDate.getHours()+7); //reconvert date
  try {
    // delete old message potentially
    const messageIdDoc = await db.collection("rememberVars").doc("prevWinnerMsgID").get();
    const result = await app.client.chat.deleteScheduledMessage({
      channel: channelId,
      scheduled_message_id: messageIdDoc.data().str
    });
    console.log("deleteOld");
    console.log(result);
  }
  catch (error) {
    console.error(error);
  }

  try {
    // Call the chat.scheduleMessage method using the WebClient
    const result = await app.client.chat.scheduleMessage({
      channel: channelId,
      text: message,
      // Time to post message, in Unix Epoch timestamp format
      post_at: sendDate.getTime() / 1000
    });
    console.log("NewMsg");
    console.log(result);
    await db.collection("rememberVars").doc("prevWinnerMsgID").set({"str": result.scheduled_message_id});
  }
  catch (error) {
    console.error(error);
  }
}

async function winnerOfTheDayUpdate(today){
  //comparing to see if it is a new day to reset scores
  const maxScore = 10;
  const newday = await newDay(today);
  if (newday){
    console.log("New Day")
    const winnersJSON = await findWinners();
    const winners = winnersJSON.Winners;
    const found = winnersJSON.Found;
    console.log(found);
    if (found){
      winners.forEach((doc) => {
        console.log(doc);
        console.log(doc.data().WOTD+1);
        doc.ref.update({WOTD:doc.data().WOTD+1});
      });
    }
    const fullRankings = await db.collection("Users").get();
    fullRankings.forEach((doc) => {
      doc.ref.update({TodaysScore:maxScore});
    });
    let oldNumDoc = await db.collection("rememberVars").doc("wordleNumber").get();
    let oldNum = oldNumDoc.data().num
    await db.collection("rememberVars").doc("wordleNumber").set({num: oldNum+1});

    //add new wordle word
    let options = new chrome.Options();
    options.setChromeBinaryPath(process.env.CHROME_BINARY_PATH);
    let serviceBuilder = new chrome.ServiceBuilder(process.env.CHROME_DRIVER_PATH);
    
    //Don't forget to add these for heroku
    options.addArguments("--headless");
    options.addArguments("--disable-gpu");
    options.addArguments("--no-sandbox");
  

    let driver = new webdriver.Builder()
        .forBrowser('chrome')
        .setChromeOptions(options)
        .setChromeService(serviceBuilder)
        .build();

        await driver.get('https://www.nytimes.com/games/wordle/index.html');
    try {
      wordoftheday = await driver.executeScript("return (new wordle.bundle.GameApp()).solution;")
      await db.collection("rememberVars").doc("WOTD").set({word: wordoftheday});
    } finally {
      await driver.quit();
    }
  }
}


async function winnerOfTheDay(){
  //get today and tomorrow dates
  let date = new Date();
  let utcDate = new Date(date.toUTCString());
  utcDate.setHours(utcDate.getHours()-7);
  let today = new Date(utcDate);

  utcDate.setDate(utcDate.getDate()+1);
  let tomorrow = new Date(utcDate);
  tomorrow.setHours(0, 0, 0);

  await winnerOfTheDayUpdate(today);

  await db.collection("rememberVars").doc("Date").set({"str": today.toDateString()});

  winnerOfTheDayMessage(tomorrow);
}

async function wordleMessage(msgEvent) {
  const score = ((msgEvent.text.substring(11, 12) === "X") ? penaltyScore : msgEvent.text.substring(11, 12));

  if(isNaN(parseInt(score))){
    publishMessage(
      msgEvent.channel,
      "Please paste your Wordle score in the default formatting to receive credit"
    );
    return;
  }
  let doc = await getUser(msgEvent.user);
  if (!doc.exists) {
    publishMessage(
      msgEvent.channel,
      "Initalize your data to compete! Use command !init. For help use !inithelp"
    );
    return;
  }

  const data = doc.data();
  data.Scores[score] = data.Scores[score] + 1;
  data.AvgScore =
    (data.AvgScore * data.TotalScores + parseInt(score)) /
    (data.TotalScores + 1);
  data.TotalScores = data.TotalScores + 1;
  data.TodaysScore = parseInt(score);

  if (parseInt(score) === 10) {
    data.totalMisses++;
  }

  await db.collection("Users").doc(msgEvent.user).set(data);

  const messages = ["Genius","Magnificent","Impressive","Splendid","Great","Whew","F"];
  const messageChoice = ((score === "10") ? "7" : score);

  publishMessage(msgEvent.channel, messages[parseInt(messageChoice)-1]);

  await winnerOfTheDay();

  await db.collection("Users").doc(msgEvent.user).set(data); //set again in case of override in winner of the day
}

function incorrectInit(msgEvent) {
  publishMessage(
    msgEvent.channel,
    "Please put your init message in the correct format. For more information on this, use !inithelp"
  );
}

function createData(Name, scoresArr, percentWin) {
  const reducer = (accumulator, curr) => accumulator + curr;
  const totalSuccesses = scoresArr.reduce(reducer); // sum of array
  const TotalScores = Math.round((totalSuccesses * 100) / percentWin); // this includes misses and successes
  const TotalMisses = TotalScores - totalSuccesses;

  let AvgScore = 0;
  for (let i = 0; i < scoresArr.length; i++) {
    AvgScore = AvgScore + (i + 1) * scoresArr[i];
  }
  AvgScore = AvgScore + TotalMisses * 10;
  AvgScore = AvgScore / TotalScores;

  const Scores = {};
  for (let i = 0; i < scoresArr.length; ++i) {
    Scores[i + 1] = scoresArr[i];
  }
  Scores[parseInt(penaltyScore)] = TotalMisses;

  const TodaysScore = 10;

  const initData = {
    Name, Scores, AvgScore, TotalScores, TotalMisses, TodaysScore
  }

  return initData;
}

// Review: if you want better tests, look up Jest. Move your test cases into a test file and turn index.js into a module/package (export your functions). For larger projects, this is useful.
function testCreateScores(words) {
  let maxScore = 6;
  let correctInput = true;

  if (words.length != maxScore + 3) {
    // if not correct length. maxscore + ! + name + %
    correctInput = false;
  }
  const scores = [];
  for (let i = 2; i < maxScore + 2; ++i) {
    let score = parseInt(words[i]);
    scores.push(score);
    if (isNaN(score)) {
      correctInput = false;
    }
  }
  if (isNaN(parseInt(words[words.length - 1])))
    //testing the %
    correctInput = false;

  return { correctInputBool: correctInput, scoresArr: scores };
}

// if the init is typed and phone auto converts it to a phone number, this fixes that
function telFix(msgEvent) {
  let text = msgEvent.text;
  text = text.replace("<tel:", "");
  text = text.substring(0, text.indexOf("|"));
  console.log(text);
  let words = text.split(" ");
  console.log(words);

  return words;
}

async function initMessage(msgEvent) {
  //if help message
  if (msgEvent.text.substring(0, 9) === "!inithelp") {
    publishMessage(
      msgEvent.channel,
      "Hello, format your init message like this: !init Name 1score 2score 3score 4score 5score 6score Win% \n For example: !init Leon 0 0 1 3 10 34 96"
    );
    return;
  }
  //if regular init message
  let words = msgEvent.text.split(" ");
  if (msgEvent.text.includes("<tel:")) {
    words = telFix(msgEvent);
  }

  let correctScores = testCreateScores(words);

  let correctInput = correctScores.correctInputBool;
  let scores = correctScores.scoresArr;

  if (!correctInput) {
    // not correct init
    incorrectInit(msgEvent);
    return;
  } // correct init
  let initData = createData(words[1], scores, words[words.length - 1]);

  let doc = await getUser(msgEvent.user);
  if (doc.exists) {
    initData["WOTD"] = doc.data().WOTD;
  }
  else
    initData["WOTD"] = 0;

  await db.collection("Users").doc(msgEvent.user).set(initData);

  publishMessage(msgEvent.channel, "Successfully initialized Wordle scores!");
}

async function getRankings(maxRankShow, orderBy) {
  const rankings = await db
    .collection("Users")
    .orderBy(orderBy)
    .limit(maxRankShow)
    .get();
  rankings.forEach((doc) => {
    console.log(doc.id, "=>", doc.data());
  });
  return rankings;
}

function incorrectLeaderboardMessage(msgEvent) {
  publishMessage(
    msgEvent.channel,
    "Please put your leaderboard message in the correct format. For more information on this, use !leaderboardhelp"
  );
}

async function leaderboardMessage(msgEvent) {
  if (msgEvent.text.substring(0, 16) === "!leaderboardhelp") {
    publishMessage(
      msgEvent.channel,
      'Hello, format your leaderboard message like this: !leaderboard maxRankingToShow \n For example: "!leaderboard 5" to view the top 5. You can also say !leaderboard MAX to view everyone'
    );
  } else {
    const words = msgEvent.text.split(" ");
    const fullRankings = await db.collection("Users").orderBy("AvgScore").get();
    let maxSize = fullRankings.size;

    if (words[1] === "MAX") {
      words[1] = maxSize;
    }
    let maxRankShow = parseInt(words[1]);

    if (words.length === 2 && !isNaN(maxRankShow)) {
      //correct input
      let message = "";

      if (maxRankShow > maxSize) maxRankShow = maxSize;

      const rankings = await getRankings(maxRankShow, "AvgScore");
      let rankShowing = 1;
      const decimalsShowing = 3;
      rankings.forEach((doc) => {
        message = `${message}${rankShowing}: ${doc.data().Name},  Average Score: ${doc.data().AvgScore.toFixed(decimalsShowing)}, Winners of the Day: ${doc.data().WOTD}\n`;
        console.log(doc.id, "=>", doc.data());
        rankShowing++;
      });
      publishMessage(msgEvent.channel, message);
    } else {
      incorrectLeaderboardMessage(msgEvent);
    }
  }
}

async function repeatMessageChecker(msgEvent){
  if (msgEvent.ts === oldTS){
    console.log("SAME");
    return true;
  }
  oldTS = msgEvent.ts;

  //doing it this way so it goes as fast as possible in case of a double msg
  const prevmsgChecker = await db.collection("rememberVars")
  .doc("msgChecker")
  .get();

  if (msgEvent.ts === prevmsgChecker.data().ts){
    console.log("SAME");
    return true;
  }

  await db.collection("rememberVars")
  .doc("msgChecker")
  .set({ts:msgEvent.ts})
  

  return false;
}

app.event("message", async ({event, say}) => {
  
  msgEvent = event;
  console.log(msgEvent);

  const repeatMsg = await repeatMessageChecker(msgEvent);
  
  if (repeatMsg) return;

  if (msgEvent.channel !== "C0358QRMRBP" && msgEvent.channel !== "C0364SKQNBA") return;

  //if posting wordle score
  if (msgEvent.text.substring(0, 6) === "Wordle" && msgEvent.text.includes("/6")) {
    wordleMessage(msgEvent);
  } 
  else if (msgEvent.text.substring(0, 8) === "Letterle") {
    letterleMessage(msgEvent);
  }
  //If command message
  else if (msgEvent.text.substring(0, 1) === "!") {
    if (msgEvent.text.substring(0, 5) === "!init") {
      initMessage(msgEvent);
    } else if (msgEvent.text.substring(0, 5) === "!help") {
      publishMessage(
        msgEvent.channel,
        "Valid commands: !init, !inithelp, !leaderboard, !leaderboardhelp. To reset your data just reinitialize using !init. Not getting the word is a 10."
      );
    } else if (msgEvent.text.substring(0, 12) === "!leaderboard") {
      leaderboardMessage(msgEvent);
    } // invalid command
    else
      publishMessage(
        msgEvent.channel,
        "This is not a valid command, use !help for help"
      );
  }
  setInterval(function() {
    http.get("http://makerswordle.herokuapp.com/");
  }, 300000); // every 5 minutes (300000)
});

app.start(port).then(() => console.log("App is running!"));

