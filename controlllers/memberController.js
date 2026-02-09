import Member from "../models/Member.js";
import { User } from "../models/User.js";

const getDurationMonths = (duration) => {
  if (duration === undefined || duration === null) return 1;
  if (typeof duration === "number") return duration;
  const value = String(duration).toLowerCase();
  if (value.includes("year")) return 12;
  if (value.includes("6")) return 6;
  if (value.includes("3")) return 3;
  return 1;
};

const getEndDate = (startDate, duration) => {
  if (!startDate) return null;
  const months = getDurationMonths(duration);
  const endDate = new Date(startDate);
  if (Number.isNaN(endDate.getTime())) return null;
  endDate.setMonth(endDate.getMonth() + months);
  return endDate;
};

const getActorFromRequest = async (req) => {
  if (!req?.user?._id) return { id: null, name: "System" };
  const user = await User.findById(req.user._id).select("name");
  return {
    id: user?._id || req.user._id,
    name: user?.name || "Unknown",
  };
};

const createMemberController = async (req, res) => {
  try {
    const fee = Number(req.body.fee || 0);
    const paidAmount = Number(req.body.paidAmount || 0);
    const remainingAmount = Math.max(fee - paidAmount, 0);
    const paymentStatus =
      req.body.paymentStatus === "Free Trial" && fee === 0
        ? "Free Trial"
        : remainingAmount === 0
        ? "Paid"
        : "Pending";

    const actor = await getActorFromRequest(req);
    const activityEntry = {
      action: "create",
      by: actor,
      at: new Date(),
      changes: {
        fee,
        paidAmount,
        remainingAmount,
        paymentStatus,
      },
    };

    const paymentEntry = {
      amount: paidAmount,
      fee,
      paidAmount,
      remainingAmount,
      paymentStatus,
      by: actor,
      at: new Date(),
      note: req.body.paymentNote,
    };

    const member = await new Member({
      ...req.body,
      fee,
      paidAmount,
      remainingAmount,
      paymentStatus,
      createdBy: actor,
      updatedBy: actor,
      activityHistory: [activityEntry],
      paymentHistory: paidAmount > 0 ? [paymentEntry] : [],
    }).save();
    return res.status(201).json({
      success: true,
      message: "Member created successfully",
      member,
    });
  } catch (error) {
    console.error("Error creating member:", error);
    return res.status(500).json({
      success: false,
      message: "Error creating member",
      error,
    });
  }
};

const getMembersController = async (req, res) => {
  try {
    const {
      search,
      paymentStatus,
      membershipType,
      personalTrainer,
      minRemaining,
      maxRemaining,
      minFee,
      maxFee,
      minPaid,
      maxPaid,
      startFrom,
      startTo,
      sortBy = "createdAt",
      sortOrder = "desc",
      page = 1,
      limit = 20,
    } = req.query;

    const query = {};

    if (search) {
      const regex = new RegExp(search, "i");
      query.$or = [
        { name: regex },
        { email: regex },
        { phone: regex },
        { assignedTrainer: regex },
      ];
    }

    if (paymentStatus) query.paymentStatus = paymentStatus;
    if (membershipType) query.membershipType = membershipType;
    if (personalTrainer) query.personalTrainer = personalTrainer;

    const toNum = (v) => (v === undefined ? undefined : Number(v));

    // const remainingQuery = {};
    // if (toNum(minRemaining) !== undefined) remainingQuery.$gte = toNum(minRemaining);
    // if (toNum(maxRemaining) !== undefined) remainingQuery.$lte = toNum(maxRemaining);
    // if (Object.keys(remainingQuery).length) query.remainingAmount = remainingQuery;

    // const feeQuery = {};
    // if (toNum(minFee) !== undefined) feeQuery.$gte = toNum(minFee);
    // if (toNum(maxFee) !== undefined) feeQuery.$lte = toNum(maxFee);
    // if (Object.keys(feeQuery).length) query.fee = feeQuery;

    // const paidQuery = {};
    // if (toNum(minPaid) !== undefined) paidQuery.$gte = toNum(minPaid);
    // if (toNum(maxPaid) !== undefined) paidQuery.$lte = toNum(maxPaid);
    // if (Object.keys(paidQuery).length) query.paidAmount = paidQuery;

    const addRangeQuery = (query, field, min, max) => {
  const range = {};

  if (min !== undefined && min !== null && min !== '')
    range.$gte = Number(min);

  if (max !== undefined && max !== null && max !== '')
    range.$lte = Number(max);

  if (Object.keys(range).length) {
    query[field] = range;
  }
};

addRangeQuery(query, 'remainingAmount', minRemaining, maxRemaining);
addRangeQuery(query, 'fee', minFee, maxFee);
addRangeQuery(query, 'paidAmount', minPaid, maxPaid);


    if (startFrom || startTo) {
      query.startDate = {};
      if (startFrom) query.startDate.$gte = new Date(startFrom);
      if (startTo) query.startDate.$lte = new Date(startTo);
    }

    const safeSortFields = new Set([
      "createdAt",
      "name",
      "fee",
      "paidAmount",
      "remainingAmount",
      "startDate",
    ]);
    const sortField = safeSortFields.has(sortBy) ? sortBy : "createdAt";
    const sortDir = String(sortOrder).toLowerCase() === "asc" ? 1 : -1;
    const sort = { [sortField]: sortDir };

    const pageNum = Math.max(Number(page) || 1, 1);
    const limitNum = Math.min(Math.max(Number(limit) || 20, 1), 100);
    const skip = (pageNum - 1) * limitNum;

    console.log("Query:", query);
    const [members, total] = await Promise.all([
      Member.find(query).sort(sort).skip(skip).limit(limitNum),
      Member.countDocuments(query),
    ]);

    const membersWithPayments = members.map((m) => {
      const obj = m.toObject();
      const history = Array.isArray(obj.paymentHistory)
        ? obj.paymentHistory
        : [];
      const lastPayment = history.length ? history[history.length - 1] : null;
      return { ...obj, lastPayment };
    });

    return res.status(200).json({
      success: true,
      members: membersWithPayments,
      page: pageNum,
      limit: limitNum,
      total,
      totalPages: Math.ceil(total / limitNum),
    });
  } catch (error) {
    console.error("Error getting members:", error);
    return res.status(500).json({
      success: false,
      message: "Error getting members",
      error,
    });
  }
};

const getMemberByIdController = async (req, res) => {
  try {
    const member = await Member.findById(req.params.id);
    if (!member) {
      return res.status(404).json({
        success: false,
        message: "Member not found",
      });
    }
    return res.status(200).json({ success: true, member });
  } catch (error) {
    console.error("Error getting member:", error);
    return res.status(500).json({
      success: false,
      message: "Error getting member",
      error,
    });
  }
};

const updateMemberController = async (req, res) => {
  try {
    const existingMember = await Member.findById(req.params.id);
    if (!existingMember) {
      return res.status(404).json({
        success: false,
        message: "Member not found",
      });
    }

    const fee =
      req.body.fee !== undefined ? Number(req.body.fee) : existingMember.fee;
    const paidAmount =
      req.body.paidAmount !== undefined
        ? Number(req.body.paidAmount)
        : existingMember.paidAmount;
    const remainingAmount = Math.max(fee - paidAmount, 0);
    const paymentStatus =
      req.body.paymentStatus === "Free Trial" && fee === 0
        ? "Free Trial"
        : remainingAmount === 0
        ? "Paid"
        : "Pending";

    const actor = await getActorFromRequest(req);

    const diff = {};
    const addIfChanged = (field, oldValue, newValue, skipIfUndefined = true) => {
      if (skipIfUndefined && newValue === undefined) return;
      const oldTime =
        oldValue instanceof Date ? oldValue.getTime() : oldValue;
      const newTime =
        newValue instanceof Date ? newValue.getTime() : newValue;
      if (oldTime !== newTime) {
        diff[field] = { from: oldValue ?? null, to: newValue ?? null };
      }
    };

    addIfChanged("name", existingMember.name, req.body.name);
    addIfChanged("email", existingMember.email, req.body.email);
    addIfChanged("phone", existingMember.phone, req.body.phone);
    addIfChanged(
      "membershipType",
      existingMember.membershipType,
      req.body.membershipType
    );
    addIfChanged("startDate", existingMember.startDate, req.body.startDate);
    addIfChanged("duration", existingMember.duration, req.body.duration);
    addIfChanged(
      "personalTrainer",
      existingMember.personalTrainer,
      req.body.personalTrainer
    );
    addIfChanged(
      "assignedTrainer",
      existingMember.assignedTrainer,
      req.body.assignedTrainer
    );
    addIfChanged("fee", existingMember.fee, fee, false);
    addIfChanged("paidAmount", existingMember.paidAmount, paidAmount, false);
    addIfChanged(
      "remainingAmount",
      existingMember.remainingAmount,
      remainingAmount,
      false
    );
    addIfChanged(
      "paymentStatus",
      existingMember.paymentStatus,
      paymentStatus,
      false
    );

    const activityEntry = Object.keys(diff).length
      ? {
          action: "update",
          by: actor,
          at: new Date(),
          changes: diff,
        }
      : null;

    const paymentDelta =
      paidAmount - Number(existingMember.paidAmount || 0);
    const paymentChanged =
      fee !== existingMember.fee ||
      paidAmount !== existingMember.paidAmount ||
      paymentStatus !== existingMember.paymentStatus ||
      remainingAmount !== existingMember.remainingAmount;

    const paymentEntry = paymentChanged
      ? {
          amount: paymentDelta,
          fee,
          paidAmount,
          remainingAmount,
          paymentStatus,
          by: actor,
          at: new Date(),
          note: req.body.paymentNote,
        }
      : null;

    const update = {
      $set: {
        ...req.body,
        fee,
        paidAmount,
        remainingAmount,
        paymentStatus,
        updatedBy: actor,
      },
    };

    if (activityEntry || paymentEntry) {
      update.$push = {};
      if (activityEntry) update.$push.activityHistory = activityEntry;
      if (paymentEntry) update.$push.paymentHistory = paymentEntry;
    }

    const member = await Member.findByIdAndUpdate(req.params.id, update, {
      new: true,
    });
    return res.status(200).json({
      success: true,
      message: "Member updated successfully",
      member,
    });
  } catch (error) {
    console.error("Error updating member:", error);
    return res.status(500).json({
      success: false,
      message: "Error updating member",
      error,
    });
  }
};

const deleteMemberController = async (req, res) => {
  try {
    const member = await Member.findByIdAndDelete(req.params.id);
    if (!member) {
      return res.status(404).json({
        success: false,
        message: "Member not found",
      });
    }
    return res.status(200).json({
      success: true,
      message: "Member deleted successfully",
    });
  } catch (error) {
    console.error("Error deleting member:", error);
    return res.status(500).json({
      success: false,
      message: "Error deleting member",
      error,
    });
  }
};

const getMemberDashboardController = async (req, res) => {
  try {
    const members = await Member.find({});
    const now = new Date();
    const nextWeek = new Date();
    nextWeek.setDate(now.getDate() + 7);

    const stats = {
      totalMembers: members.length,
      totalFee: 0,
      totalPaid: 0,
      totalRemaining: 0,
      pendingCount: 0,
      dueNextWeekCount: 0,
      paymentStatusCounts: { Paid: 0, Pending: 0, "Free Trial": 0 },
      membershipTypeCounts: {},
      dueNextWeekMembers: [],
    };

    for (const m of members) {
      const fee = Number(m.fee || 0);
      const paid = Number(m.paidAmount || 0);
      const remaining =
        m.remainingAmount ?? Math.max(fee - paid, 0);

      stats.totalFee += fee;
      stats.totalPaid += paid;
      stats.totalRemaining += remaining;

      if (remaining > 0) stats.pendingCount += 1;

      const status =
        m.paymentStatus === "Free Trial" && fee === 0
          ? "Free Trial"
          : remaining === 0
          ? "Paid"
          : "Pending";
      stats.paymentStatusCounts[status] =
        (stats.paymentStatusCounts[status] || 0) + 1;

      const type = m.membershipType || "Other";
      stats.membershipTypeCounts[type] =
        (stats.membershipTypeCounts[type] || 0) + 1;

      const effectiveStartDate = m.startDate || m.createdAt;
      const endDate = getEndDate(effectiveStartDate, m.duration);
      if (endDate && endDate >= now && endDate <= nextWeek) {
        stats.dueNextWeekCount += 1;
        if (stats.dueNextWeekMembers.length < 8) {
          stats.dueNextWeekMembers.push({
            _id: m._id,
            name: m.name,
            phone: m.phone,
            remainingAmount: remaining,
            endDate,
          });
        }
      }
    }

    stats.dueNextWeekMembers.sort(
      (a, b) => new Date(a.endDate) - new Date(b.endDate)
    );

    return res.status(200).json({ success: true, stats });
  } catch (error) {
    console.error("Error getting member dashboard stats:", error);
    return res.status(500).json({
      success: false,
      message: "Error getting member dashboard stats",
      error,
    });
  }
};

export {
  createMemberController,
  getMembersController,
  getMemberByIdController,
  updateMemberController,
  deleteMemberController,
  getMemberDashboardController,
};
