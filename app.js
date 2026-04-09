// downloaded package require
import express from "express";
import bodyParser from "body-parser";
import cors from "cors";
import * as dotenv from "dotenv";
import path from "path";
import fs from "fs";

dotenv.config();

const app = express();

// initialise downlaoded package
app.use(cors());
app.use(express.json());
app.use(bodyParser.urlencoded({extended:true}));

const uploadsDir = process.env.UPLOADS_DIR
  ? path.resolve(process.env.UPLOADS_DIR)
  : path.join(process.cwd(), "uploads");

if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

app.use("/uploads", express.static(uploadsDir));

const PORT = process.env.PORT || 5000;
// user defined package
import connectDB from "./utils/connectDB.js";
// import User from "./models/User.js";
import authRoute from "./routes/authRoute.js";
import planRoute from "./routes/planCategoryRoute.js";
import subscriptionRoute from "./routes/subscriptionRoute.js";
import ContactRoute from "./routes/contactRoute.js";
import feedBackRoute from "./routes/feedBackRoute.js";
import memberRoute from "./routes/memberRoute.js";
import expenseRoute from "./routes/expenseRoute.js";
import inquiryRoute from "./routes/inquiryRoute.js";
import supplementRoute from "./routes/supplementRoute.js";

app.get("/", (req, res) =>{
res.send("server is running successfully");
});

app.use("/api/v1/auth", authRoute);
app.use("/api/v1/plan", planRoute);
app.use("/api/v1/subscription", subscriptionRoute);
app.use("/api/v1/contact", ContactRoute);
app.use("/api/v1/feedback", feedBackRoute);
app.use("/api/v1/members", memberRoute);
app.use("/api/v1/expenses", expenseRoute);
app.use("/api/v1/inquiries", inquiryRoute);
app.use("/api/v1/supplements", supplementRoute);


const startServer = async () => {
    try{
        connectDB(process.env.MONGODB_URI);
        app.listen(PORT, () => {
         console.log(`server is running on port ${PORT}`);
        });        
    }

    catch(err){
        console.log(err || "some error in starting server");
    }
}

startServer();








