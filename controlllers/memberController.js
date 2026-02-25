import Member from "../models/Member.js";
import { User } from "../models/User.js";
import Expense from "../models/Expense.js";

const getDurationMonths = (duration) => {
  if (duration === undefined || duration === null) return 1;
  if (typeof duration === "number") return duration;
  const value = String(duration).toLowerCase();
  if (value.includes("year")) return 12;
  if (value.includes("6")) return 6;
  if (value.includes("3")) return 3;
  return 1;
};

const addMonths = (date, months) => {
  const next = new Date(date);
  if (Number.isNaN(next.getTime())) return null;
  next.setMonth(next.getMonth() + months);
  return next;
};

const parseRangeDate = (value, endOfDay = false) => {
  if (!value) return null;
  const raw = String(value).trim();
  if (!raw) return null;

  const dateOnlyMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateOnlyMatch) {
    const year = Number(dateOnlyMatch[1]);
    const month = Number(dateOnlyMatch[2]) - 1;
    const day = Number(dateOnlyMatch[3]);
    const utcMs = endOfDay
      ? Date.UTC(year, month, day, 23, 59, 59, 999)
      : Date.UTC(year, month, day, 0, 0, 0, 0);
    return new Date(utcMs);
  }

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
};

const getActorFromRequest = async (req) => {
  if (!req?.user?._id) return { id: null, name: "System" };
  const user = await User.findById(req.user._id).select("name");
  return {
    id: user?._id || req.user._id,
    name: user?.name || "Unknown",
  };
};

const parsePaymentMonth = (value) => {
  if (!value) return null;
  const raw = String(value).trim();
  if (!raw) return null;

  const parsed = new Date(`01 ${raw}`);
  if (!Number.isNaN(parsed.getTime())) return parsed;

  const monthMap = {
    january: 0,
    february: 1,
    march: 2,
    april: 3,
    may: 4,
    june: 5,
    july: 6,
    august: 7,
    september: 8,
    october: 9,
    november: 10,
    december: 11,
  };
  const match = raw.toLowerCase().match(/^([a-z]+)\s+(\d{4})$/);
  if (!match) return null;
  const month = monthMap[match[1]];
  const year = Number(match[2]);
  if (month === undefined || Number.isNaN(year)) return null;
  return new Date(year, month, 1);
};

const buildCycle = (startDate, cycleMonths, fee) => {
  const endDate = addMonths(startDate, cycleMonths);
  return {
    startDate,
    endDate,
    cycleMonths,
    fee,
    paidAmount: 0,
    remainingAmount: Math.max(fee - 0, 0),
    status: fee === 0 ? "Paid" : "Pending",
    payments: [],
  };
};

const ensurePaymentCycles = (member) => {
  const cycles = Array.isArray(member.paymentCycles)
    ? member.paymentCycles
    : [];
  const cycleMonths = getDurationMonths(member.duration);
  const fee = Number(member.fee || 0);

  if (cycles.length === 0) {
    const start = member.startDate ? new Date(member.startDate) : new Date();
    cycles.push(buildCycle(start, cycleMonths, fee));
  }

  let last = cycles[cycles.length - 1];
  if (!last.endDate) {
    last.endDate = addMonths(last.startDate, last.cycleMonths || cycleMonths);
  }

  member.paymentCycles = cycles;
};

const ensureCycleForPaymentMonth = (member, paymentMonthLabel) => {
  const targetMonth = parsePaymentMonth(paymentMonthLabel);
  if (!targetMonth) return null;

  ensurePaymentCycles(member);
  const cycles = member.paymentCycles || [];
  const cycleMonths = getDurationMonths(member.duration);
  const fee = Number(member.fee || 0);

  while (true) {
    const matchIndex = cycles.findIndex((cycle) => {
      const start = cycle?.startDate ? new Date(cycle.startDate) : null;
      if (!start || Number.isNaN(start.getTime())) return false;
      return (
        start.getFullYear() === targetMonth.getFullYear() &&
        start.getMonth() === targetMonth.getMonth()
      );
    });

    if (matchIndex >= 0) return matchIndex;

    const last = cycles[cycles.length - 1];
    if (!last?.endDate) return null;
    const lastStart = last.startDate ? new Date(last.startDate) : null;
    if (!lastStart || Number.isNaN(lastStart.getTime())) return null;

    const lastMonthKey = lastStart.getFullYear() * 12 + lastStart.getMonth();
    const targetMonthKey = targetMonth.getFullYear() * 12 + targetMonth.getMonth();
    if (lastMonthKey >= targetMonthKey) return null;

    const nextStart = new Date(last.endDate);
    cycles.push(buildCycle(nextStart, cycleMonths, fee));
  }
};

const applyPaymentToSingleCycle = (
  member,
  cycleIndex,
  amount,
  actor,
  note,
  at,
  type = "payment"
) => {
  const cycles = member.paymentCycles || [];
  const cycle = cycles[cycleIndex];
  if (!cycle || amount <= 0) return { applied: 0, allocations: [] };

  const applied = Math.min(Number(cycle.remainingAmount || 0), Number(amount || 0));
  if (applied <= 0) return { applied: 0, allocations: [] };

  cycle.paidAmount += applied;
  cycle.remainingAmount -= applied;
  cycle.status = cycle.remainingAmount === 0 ? "Paid" : "Pending";
  cycle.payments.push({
    amount: applied,
    type,
    by: actor,
    at,
    note,
  });

  return {
    applied,
    allocations: [
      {
        startDate: cycle.startDate,
        endDate: cycle.endDate,
        amount: applied,
      },
    ],
  };
};

const applyPaymentToCycles = (member, amount, actor, note, at, type = "payment") => {
  let remaining = Number(amount || 0);
  if (remaining === 0) return { applied: 0, allocations: [] };
  const allocations = [];
  const cycles = member.paymentCycles || [];

  let index = 0;
  while (remaining > 0) {
    const cycle = cycles[index];
    if (!cycle) break;

    if (cycle.remainingAmount <= 0) {
      index += 1;
      continue;
    }

    const applied = Math.min(cycle.remainingAmount, remaining);
    cycle.paidAmount += applied;
    cycle.remainingAmount -= applied;
    cycle.status = cycle.remainingAmount === 0 ? "Paid" : "Pending";
    cycle.payments.push({
      amount: applied,
      type,
      by: actor,
      at,
      note,
    });
    allocations.push({
      startDate: cycle.startDate,
      endDate: cycle.endDate,
      amount: applied,
    });
    remaining -= applied;
    if (cycle.remainingAmount <= 0) {
      index += 1;
    }
  }

  return { applied: Number(amount || 0) - remaining, allocations };
};

const applyAdjustmentToCurrentCycle = (member, amount, actor, note, at) => {
  const cycles = member.paymentCycles || [];
  const current = cycles[cycles.length - 1];
  if (!current || amount === 0) return;
  const adjust = Math.min(current.paidAmount, Math.abs(amount));
  current.paidAmount -= adjust;
  current.remainingAmount = Math.max(current.fee - current.paidAmount, 0);
  current.status = current.remainingAmount === 0 ? "Paid" : "Pending";
  current.payments.push({
    amount: -adjust,
    type: "adjustment",
    by: actor,
    at,
    note,
  });
};

const adjustPaymentHistoryEntry = (member, historyIndex, newAmount, actor, note) => {
  if (!Array.isArray(member.paymentHistory)) {
    throw new Error("Payment history not available");
  }
  const entry = member.paymentHistory[historyIndex];
  if (!entry) {
    throw new Error("Payment history entry not found");
  }
  if (entry.type !== "payment") {
    throw new Error("Only payment entries can be adjusted");
  }
  const oldAmount = Number(entry.amount || 0);
  const targetAmount = Number(newAmount || 0);
  const delta = targetAmount - oldAmount;
  if (delta === 0) return { delta: 0, allocations: [] };

  const allocations = Array.isArray(entry.allocations) ? entry.allocations : [];
  if (allocations.length === 0) {
    throw new Error("Cannot adjust payment without allocations");
  }

  let remaining = delta;
  const cycleAdjustments = [];

  for (const alloc of allocations) {
    if (remaining === 0) break;
    const cycle = (member.paymentCycles || []).find((c) => {
      return (
        c.startDate &&
        c.endDate &&
        new Date(c.startDate).getTime() === new Date(alloc.startDate).getTime() &&
        new Date(c.endDate).getTime() === new Date(alloc.endDate).getTime()
      );
    });
    if (!cycle) continue;

    if (remaining > 0) {
      const add = Math.min(Number(cycle.remainingAmount || 0), remaining);
      if (add > 0) {
        cycle.paidAmount += add;
        cycle.remainingAmount -= add;
        cycle.status = cycle.remainingAmount === 0 ? "Paid" : "Pending";
        cycle.payments.push({
          amount: add,
          type: "adjustment",
          by: actor,
          at: new Date(),
          note,
        });
        cycleAdjustments.push({
          startDate: cycle.startDate,
          endDate: cycle.endDate,
          amount: add,
        });
        remaining -= add;
      }
    } else {
      const reduce = Math.min(Number(cycle.paidAmount || 0), Math.abs(remaining));
      if (reduce > 0) {
        cycle.paidAmount -= reduce;
        cycle.remainingAmount = Math.max(cycle.fee - cycle.paidAmount, 0);
        cycle.status = cycle.remainingAmount === 0 ? "Paid" : "Pending";
        cycle.payments.push({
          amount: -reduce,
          type: "adjustment",
          by: actor,
          at: new Date(),
          note,
        });
        cycleAdjustments.push({
          startDate: cycle.startDate,
          endDate: cycle.endDate,
          amount: -reduce,
        });
        remaining += reduce;
      }
    }
  }

  if (remaining !== 0) {
    throw new Error("Cannot apply adjustment due to cycle limits");
  }

  entry.amount = targetAmount;

  return { delta, allocations: cycleAdjustments };
};

const syncMemberPaymentSummary = (member) => {
  const cycles = member.paymentCycles || [];
  const current = cycles.length ? cycles[cycles.length - 1] : null;
  const totalRemaining = cycles.reduce(
    (sum, c) => sum + Number(c.remainingAmount || 0),
    0
  );
  if (current) {
    member.paidAmount = Number(current.paidAmount || 0);
  }
  member.remainingAmount = totalRemaining;
  member.paymentStatus =
    member.paymentStatus === "Free Trial" && Number(member.fee || 0) === 0
      ? "Free Trial"
      : totalRemaining === 0
      ? "Paid"
      : "Pending";
};

const getCurrentCycle = (member) => {
  const cycles = Array.isArray(member?.paymentCycles) ? member.paymentCycles : [];
  return cycles.length ? cycles[cycles.length - 1] : null;
};

const createMemberController = async (req, res) => {
  try {
    const fee = Number(req.body.fee || 0);
    const paidAmount = Number(req.body.paidAmount || 0);
    const paymentStatus =
      req.body.paymentStatus === "Free Trial" && fee === 0
        ? "Free Trial"
        : "Pending";

    const actor = await getActorFromRequest(req);
    const activityEntry = {
      action: "create",
      by: actor,
      at: new Date(),
      changes: {
        fee,
        paidAmount,
        paymentStatus,
      },
    };

    const member = new Member({
      ...req.body,
      fee,
      paymentStatus,
      memberStatus: req.body.memberStatus || "Active",
      reminderStatus: req.body.reminderStatus || "None",
      createdBy: actor,
      updatedBy: actor,
      activityHistory: [activityEntry],
      paymentHistory: [],
      paymentCycles: [],
    });

    ensurePaymentCycles(member);

    let appliedOnCreate = null;
    if (paidAmount > 0) {
      appliedOnCreate = applyPaymentToCycles(
        member,
        paidAmount,
        actor,
        req.body.paymentNote,
        new Date()
      );
    }

    syncMemberPaymentSummary(member);

    if (appliedOnCreate?.applied > 0) {
      member.paymentHistory.push({
        amount: paidAmount,
        unappliedAmount: Math.max(paidAmount - Number(appliedOnCreate.applied || 0), 0),
        type: "payment",
        fee,
        paidAmount: member.paidAmount,
        remainingAmount: member.remainingAmount,
        paymentStatus: member.paymentStatus,
        by: actor,
        at: new Date(),
        note: req.body.paymentNote,
        paymentMonth: req.body.paymentMonth,
        paymentMode: req.body.paymentMode || "Cash",
        allocations: appliedOnCreate.allocations,
      });
    }

    await member.save();
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
      memberStatus,
      reminderStatus,
      listType,
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
    if (memberStatus) query.memberStatus = memberStatus;
    if (reminderStatus) query.reminderStatus = reminderStatus;
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
      if (startFrom) {
        const start = parseRangeDate(startFrom, false);
        if (start) query.startDate.$gte = start;
      }
      if (startTo) {
        const end = parseRangeDate(startTo, true);
        if (end) query.startDate.$lte = end;
      }
      if (!Object.keys(query.startDate).length) delete query.startDate;
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

    // console.log("Query:", query);
    const needsDerivedListFilter = listType === "active" || listType === "reminder";

    const [members, totalRaw] = await Promise.all([
      needsDerivedListFilter
        ? Member.find(query).sort(sort)
        : Member.find(query).sort(sort).skip(skip).limit(limitNum),
      needsDerivedListFilter ? Promise.resolve(0) : Member.countDocuments(query),
    ]);

    const now = new Date();
    const hydratedMembers = await Promise.all(
      members.map(async (m) => {
        ensurePaymentCycles(m);
        syncMemberPaymentSummary(m);
        if (m.isModified()) {
          await m.save();
        }
        const obj = m.toObject();
        const history = Array.isArray(obj.paymentHistory) ? obj.paymentHistory : [];
        const lastPayment = history.length ? history[history.length - 1] : null;
        const currentCycle = getCurrentCycle(obj);
        const expiryDate = currentCycle?.endDate || null;
        const expiry = expiryDate ? new Date(expiryDate) : null;
        const isExpired = expiry ? expiry < now : false;
        const storedRemaining = Number(obj.remainingAmount || 0);
        const dueForExpiredPaidCycle =
          obj.memberStatus === "Active" && isExpired
            ? Number(obj.fee || 0)
            : 0;
        const dueNowAmount = storedRemaining + dueForExpiredPaidCycle;
        const displayPaymentStatus =
          dueNowAmount > 0
            ? "Pending"
            : obj.paymentStatus === "Free Trial" && Number(obj.fee || 0) === 0
            ? "Free Trial"
            : "Paid";
        return {
          ...obj,
          lastPayment,
          expiryDate,
          isExpired,
          dueNowAmount,
          displayPaymentStatus,
          lastPaymentMonth: lastPayment?.paymentMonth || null,
        };
      })
    );

    const membersWithPayments = hydratedMembers.filter((m) => {
      if (listType === "active") {
        return (
          m.memberStatus === "Active" &&
          m.expiryDate &&
          new Date(m.expiryDate) >= now
        );
      }
      if (listType === "reminder") {
        const promised = m.reminderStatus === "Promised";
        const pending = Number(m.dueNowAmount || 0) > 0;
        return m.memberStatus === "Active" && (m.isExpired || pending || promised);
      }
      return true;
    });

    const total = needsDerivedListFilter ? membersWithPayments.length : totalRaw;
    const pagedMembers = needsDerivedListFilter
      ? membersWithPayments.slice(skip, skip + limitNum)
      : membersWithPayments;

    return res.status(200).json({
      success: true,
      members: pagedMembers,
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
    ensurePaymentCycles(member);
    syncMemberPaymentSummary(member);
    await member.save();
    const cycles = member.paymentCycles || [];
    const currentCycle = cycles.length ? cycles[cycles.length - 1] : null;
    const totalOutstanding = cycles.reduce(
      (sum, c) => sum + Number(c.remainingAmount || 0),
      0
    );
    const expiryDate = currentCycle?.endDate || null;
    const isExpired = expiryDate ? new Date(expiryDate) < new Date() : false;
    const storedRemaining = Number(member.remainingAmount || 0);
    const dueForExpiredPaidCycle =
      member.memberStatus === "Active" && isExpired
        ? Number(member.fee || 0)
        : 0;
    const dueNowAmount = storedRemaining + dueForExpiredPaidCycle;
    return res.status(200).json({
      success: true,
      member,
      currentCycle,
      totalOutstanding,
      expiryDate,
      isExpired,
      dueNowAmount,
    });
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
    const member = await Member.findById(req.params.id);
    if (!member) {
      return res.status(404).json({
        success: false,
        message: "Member not found",
      });
    }

    const fee =
      req.body.fee !== undefined ? Number(req.body.fee) : member.fee;

    const actor = await getActorFromRequest(req);

    ensurePaymentCycles(member);

    const cycles = member.paymentCycles || [];
    const currentCycle = cycles.length ? cycles[cycles.length - 1] : null;
    const existingPaid = currentCycle ? Number(currentCycle.paidAmount || 0) : 0;
    const desiredPaid =
      req.body.paidAmount !== undefined ? Number(req.body.paidAmount) : existingPaid;
    const paymentDelta = desiredPaid - existingPaid;

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

    addIfChanged("name", member.name, req.body.name);
    addIfChanged("email", member.email, req.body.email);
    addIfChanged("phone", member.phone, req.body.phone);
    addIfChanged(
      "membershipType",
      member.membershipType,
      req.body.membershipType
    );
    addIfChanged("startDate", member.startDate, req.body.startDate);
    addIfChanged("duration", member.duration, req.body.duration);
    addIfChanged(
      "personalTrainer",
      member.personalTrainer,
      req.body.personalTrainer
    );
    addIfChanged(
      "assignedTrainer",
      member.assignedTrainer,
      req.body.assignedTrainer
    );
    addIfChanged("memberStatus", member.memberStatus, req.body.memberStatus);
    addIfChanged("reminderStatus", member.reminderStatus, req.body.reminderStatus);
    addIfChanged("fee", member.fee, fee, false);
    addIfChanged("paidAmount", existingPaid, desiredPaid, false);

    const activityEntry = Object.keys(diff).length
      ? {
          action: "update",
          by: actor,
          at: new Date(),
          changes: diff,
        }
      : null;

    if (req.body.startDate !== undefined) member.startDate = req.body.startDate;
    if (req.body.duration !== undefined) member.duration = req.body.duration;
    if (req.body.membershipType !== undefined)
      member.membershipType = req.body.membershipType;
    if (req.body.personalTrainer !== undefined)
      member.personalTrainer = req.body.personalTrainer;
    if (req.body.assignedTrainer !== undefined)
      member.assignedTrainer = req.body.assignedTrainer;
    if (req.body.name !== undefined) member.name = req.body.name;
    if (req.body.email !== undefined) member.email = req.body.email;
    if (req.body.phone !== undefined) member.phone = req.body.phone;
    if (req.body.gender !== undefined) member.gender = req.body.gender;
    if (req.body.address !== undefined) member.address = req.body.address;
    if (req.body.emergencyName !== undefined)
      member.emergencyName = req.body.emergencyName;
    if (req.body.emergencyPhone !== undefined)
      member.emergencyPhone = req.body.emergencyPhone;
    if (req.body.healthNotes !== undefined)
      member.healthNotes = req.body.healthNotes;
    if (req.body.profilePic !== undefined)
      member.profilePic = req.body.profilePic;
    if (req.body.memberStatus !== undefined)
      member.memberStatus = req.body.memberStatus;
    if (req.body.reminderStatus !== undefined)
      member.reminderStatus = req.body.reminderStatus;
    if (req.body.paymentStatus !== undefined) {
      member.paymentStatus = req.body.paymentStatus;
    }

    if (fee !== member.fee) {
      member.fee = fee;
    }

    let paymentHistoryEntry = null;
    if (paymentDelta > 0) {
      const applied = applyPaymentToCycles(
        member,
        paymentDelta,
        actor,
        req.body.paymentNote,
        new Date(),
        "payment"
      );
      if (applied.applied > 0) {
        paymentHistoryEntry = {
          amount: paymentDelta,
          unappliedAmount: Math.max(paymentDelta - Number(applied.applied || 0), 0),
          type: "payment",
          fee: member.fee,
          by: actor,
          at: new Date(),
          note: req.body.paymentNote,
          paymentMonth: req.body.paymentMonth,
          paymentMode: req.body.paymentMode || "Cash",
          allocations: applied.allocations,
        };
      }
    } else if (paymentDelta < 0) {
      applyAdjustmentToCurrentCycle(
        member,
        paymentDelta,
        actor,
        req.body.paymentNote,
        new Date()
      );
      paymentHistoryEntry = {
        amount: paymentDelta,
        type: "adjustment",
        fee: member.fee,
        by: actor,
        at: new Date(),
        note: req.body.paymentNote,
        paymentMonth: req.body.paymentMonth,
        paymentMode: req.body.paymentMode || "Cash",
        allocations: currentCycle
          ? [
              {
                startDate: currentCycle.startDate,
                endDate: currentCycle.endDate,
                amount: paymentDelta,
              },
            ]
          : [],
      };
    }

    if (activityEntry) {
      member.activityHistory.push(activityEntry);
    }
    member.updatedBy = actor;

    syncMemberPaymentSummary(member);

    if (paymentHistoryEntry) {
      member.paymentHistory.push({
        ...paymentHistoryEntry,
        paidAmount: member.paidAmount,
        remainingAmount: member.remainingAmount,
        paymentStatus: member.paymentStatus,
      });
    }

    await member.save();
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

const uploadMemberProfileController = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "No file uploaded",
      });
    }

    const baseUrl = `${req.protocol}://${req.get("host")}`;
    const fileUrl = `${baseUrl}/uploads/${req.file.filename}`;
    return res.status(200).json({
      success: true,
      url: fileUrl,
      filename: req.file.filename,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Error uploading file",
      error,
    });
  }
};

const adjustMemberPaymentHistoryController = async (req, res) => {
  try {
    const member = await Member.findById(req.params.id);
    if (!member) {
      return res.status(404).json({
        success: false,
        message: "Member not found",
      });
    }

    const { historyIndex, newAmount, note } = req.body;
    if (historyIndex === undefined || newAmount === undefined) {
      return res.status(400).json({
        success: false,
        message: "historyIndex and newAmount are required",
      });
    }

    ensurePaymentCycles(member);
    const actor = await getActorFromRequest(req);

    const result = adjustPaymentHistoryEntry(
      member,
      Number(historyIndex),
      Number(newAmount),
      actor,
      note
    );

    syncMemberPaymentSummary(member);

    member.paymentHistory.push({
      amount: result.delta,
      type: "adjustment",
      fee: member.fee,
      paidAmount: member.paidAmount,
      remainingAmount: member.remainingAmount,
      paymentStatus: member.paymentStatus,
      by: actor,
      at: new Date(),
      note,
      paymentMonth: req.body?.paymentMonth,
      paymentMode: req.body?.paymentMode || "Cash",
      allocations: result.allocations,
    });

    await member.save();
    return res.status(200).json({
      success: true,
      message: "Payment adjusted successfully",
      member,
    });
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: error.message || "Error adjusting payment",
    });
  }
};

const updateMemberPaymentStatusController = async (req, res) => {
  try {
    const member = await Member.findById(req.params.id);
    if (!member) {
      return res.status(404).json({
        success: false,
        message: "Member not found",
      });
    }
    const index = Number(req.params.index);
    const { paymentStatus } = req.body;
    if (!paymentStatus) {
      return res.status(400).json({
        success: false,
        message: "paymentStatus is required",
      });
    }
    if (!Array.isArray(member.paymentHistory) || !member.paymentHistory[index]) {
      return res.status(404).json({
        success: false,
        message: "Payment history entry not found",
      });
    }

    member.paymentHistory[index].paymentStatus = paymentStatus;
    await member.save();
    return res.status(200).json({
      success: true,
      message: "Payment status updated",
      member,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Error updating payment status",
      error,
    });
  }
};

const deleteMemberPaymentHistoryController = async (req, res) => {
  try {
    const member = await Member.findById(req.params.id);
    if (!member) {
      return res.status(404).json({
        success: false,
        message: "Member not found",
      });
    }
    const index = Number(req.params.index);
    if (!Array.isArray(member.paymentHistory) || !member.paymentHistory[index]) {
      return res.status(404).json({
        success: false,
        message: "Payment history entry not found",
      });
    }

    ensurePaymentCycles(member);
    const actor = await getActorFromRequest(req);
    const entry = member.paymentHistory[index];
    if (entry.type !== "payment") {
      return res.status(400).json({
        success: false,
        message: "Only payment entries can be deleted",
      });
    }
    adjustPaymentHistoryEntry(member, index, 0, actor, req.body?.note);

    member.paymentHistory.splice(index, 1);

    syncMemberPaymentSummary(member);

    member.paymentHistory.push({
      amount: -Number(entry.amount || 0),
      type: "adjustment",
      fee: member.fee,
      paidAmount: member.paidAmount,
      remainingAmount: member.remainingAmount,
      paymentStatus: member.paymentStatus,
      by: actor,
      at: new Date(),
      note: req.body?.note || "Deleted payment entry",
      allocations: entry.allocations || [],
    });

    await member.save();
    return res.status(200).json({
      success: true,
      message: "Payment deleted",
      member,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Error deleting payment",
      error,
    });
  }
};

const addMemberPaymentController = async (req, res) => {
  try {
    const member = await Member.findById(req.params.id);
    if (!member) {
      return res.status(404).json({
        success: false,
        message: "Member not found",
      });
    }

    const amount = Number(req.body.amount || 0);
    if (!amount || amount <= 0) {
      return res.status(400).json({
        success: false,
        message: "Amount must be greater than 0",
      });
    }
    if (!req.body.paymentMonth) {
      return res.status(400).json({
        success: false,
        message: "paymentMonth is required",
      });
    }
    if (!req.body.paymentMode) {
      return res.status(400).json({
        success: false,
        message: "paymentMode is required",
      });
    }

    ensurePaymentCycles(member);
    const actor = await getActorFromRequest(req);
    const paymentAt = req.body.date ? new Date(req.body.date) : new Date();
    if (Number.isNaN(paymentAt.getTime())) {
      return res.status(400).json({
        success: false,
        message: "Invalid payment date",
      });
    }
    const taggedCycleIndex = ensureCycleForPaymentMonth(
      member,
      req.body.paymentMonth
    );
    if (req.body.paymentMonth && taggedCycleIndex === null) {
      return res.status(400).json({
        success: false,
        message:
          "Selected payment month is outside this member timeline. Use a valid month or set membership start/restart for historical entry.",
      });
    }
    const previousRemaining = Number(
      taggedCycleIndex !== null
        ? member.paymentCycles?.[taggedCycleIndex]?.remainingAmount || 0
        : member.remainingAmount || 0
    );
    const applied =
      taggedCycleIndex !== null
        ? applyPaymentToSingleCycle(
            member,
            taggedCycleIndex,
            amount,
            actor,
            req.body.note,
            paymentAt,
            "payment"
          )
        : applyPaymentToCycles(
            member,
            amount,
            actor,
            req.body.note,
            paymentAt,
            "payment"
          );

    syncMemberPaymentSummary(member);

    const relevantRemaining =
      taggedCycleIndex !== null
        ? Number(member.paymentCycles?.[taggedCycleIndex]?.remainingAmount || 0)
        : Number(member.remainingAmount || 0);
    const isPartialPayment = relevantRemaining > 0 && amount < previousRemaining;
    let promisedDate = null;
    if (isPartialPayment) {
      if (!req.body.promiseDate) {
        return res.status(400).json({
          success: false,
          message: "promiseDate is required for partial payment",
        });
      }
      promisedDate = new Date(req.body.promiseDate);
      if (Number.isNaN(promisedDate.getTime())) {
        return res.status(400).json({
          success: false,
          message: "Invalid promiseDate",
        });
      }
      if (promisedDate < paymentAt) {
        return res.status(400).json({
          success: false,
          message: "promiseDate cannot be earlier than payment date",
        });
      }
      member.reminderStatus = "Promised";
      member.promisedPaymentDate = promisedDate;
    } else if (Number(member.remainingAmount || 0) <= 0) {
      member.reminderStatus = "None";
      member.promisedPaymentDate = null;
    }

    member.paymentHistory.push({
      amount,
      unappliedAmount: Math.max(amount - Number(applied.applied || 0), 0),
      type: "payment",
      fee: member.fee,
      paidAmount: member.paidAmount,
      remainingAmount: member.remainingAmount,
      paymentStatus: member.paymentStatus,
      by: actor,
      at: paymentAt,
      note: req.body.note,
      paymentMonth: req.body.paymentMonth,
      paymentMode: req.body.paymentMode,
      promiseDate: promisedDate,
      allocations: applied.allocations,
    });

    await member.save();
    return res.status(200).json({
      success: true,
      message: "Payment added successfully",
      member,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Error adding payment",
      error,
    });
  }
};

const startFreshMemberCycle = (member, options = {}) => {
  const startDate = options.startDate ? new Date(options.startDate) : new Date();
  if (Number.isNaN(startDate.getTime())) {
    throw new Error("Invalid startDate");
  }

  const nextDuration = options.duration || member.duration;
  const nextFee =
    options.fee !== undefined ? Number(options.fee) : Number(member.fee || 0);
  const cycleMonths = getDurationMonths(nextDuration);

  ensurePaymentCycles(member);
  const current = getCurrentCycle(member);
  if (current && Number(current.remainingAmount || 0) > 0) {
    current.remainingAmount = 0;
    current.status = "Paid";
  }

  member.duration = nextDuration;
  member.fee = nextFee;
  member.startDate = startDate;
  member.memberStatus = "Active";
  member.reminderStatus = "None";

  member.paymentCycles.push(buildCycle(startDate, cycleMonths, nextFee));
  syncMemberPaymentSummary(member);
};

const restartMemberCycleController = async (req, res) => {
  try {
    const member = await Member.findById(req.params.id);
    if (!member) {
      return res.status(404).json({
        success: false,
        message: "Member not found",
      });
    }

    const actor = await getActorFromRequest(req);
    startFreshMemberCycle(member, {
      startDate: req.body.startDate,
      duration: req.body.duration,
      fee: req.body.fee,
    });

    member.updatedBy = actor;
    member.activityHistory.push({
      action: "restart_cycle",
      by: actor,
      at: new Date(),
      changes: {
        startDate: member.startDate,
        duration: member.duration,
        fee: member.fee,
      },
    });

    await member.save();
    return res.status(200).json({
      success: true,
      message: "New cycle started",
      member,
    });
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: error.message || "Error restarting cycle",
    });
  }
};

const updateMemberStatusController = async (req, res) => {
  try {
    const member = await Member.findById(req.params.id);
    if (!member) {
      return res.status(404).json({
        success: false,
        message: "Member not found",
      });
    }

    const { memberStatus } = req.body;
    if (!["Active", "Inactive"].includes(memberStatus)) {
      return res.status(400).json({
        success: false,
        message: "memberStatus must be Active or Inactive",
      });
    }

    const actor = await getActorFromRequest(req);
    const oldStatus = member.memberStatus || "Active";

    if (oldStatus === "Inactive" && memberStatus === "Active") {
      startFreshMemberCycle(member, {
        startDate: req.body.startDate,
        duration: req.body.duration,
        fee: req.body.fee,
      });
    } else {
      member.memberStatus = memberStatus;
      syncMemberPaymentSummary(member);
    }

    member.updatedBy = actor;
    member.activityHistory.push({
      action: "member_status",
      by: actor,
      at: new Date(),
      changes: {
        from: oldStatus,
        to: memberStatus,
      },
    });

    await member.save();
    return res.status(200).json({
      success: true,
      message:
        oldStatus === "Inactive" && memberStatus === "Active"
          ? "Member reactivated with fresh cycle"
          : "Member status updated",
      member,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Error updating member status",
      error,
    });
  }
};

const extendMemberCycleController = async (req, res) => {
  try {
    const member = await Member.findById(req.params.id);
    if (!member) {
      return res.status(404).json({
        success: false,
        message: "Member not found",
      });
    }

    const extendDays = Number(req.body.extendDays || 0);
    if (!Number.isFinite(extendDays) || extendDays <= 0) {
      return res.status(400).json({
        success: false,
        message: "extendDays must be greater than 0",
      });
    }

    ensurePaymentCycles(member);
    const currentCycle = getCurrentCycle(member);
    if (!currentCycle?.endDate) {
      return res.status(400).json({
        success: false,
        message: "Current cycle not found",
      });
    }

    const actor = await getActorFromRequest(req);
    const oldEndDate = new Date(currentCycle.endDate);
    const nextEndDate = new Date(oldEndDate);
    nextEndDate.setDate(nextEndDate.getDate() + extendDays);
    currentCycle.endDate = nextEndDate;

    member.updatedBy = actor;
    member.activityHistory.push({
      action: "extend_cycle_days",
      by: actor,
      at: new Date(),
      changes: {
        extendDays,
        from: oldEndDate,
        to: nextEndDate,
      },
    });

    syncMemberPaymentSummary(member);
    await member.save();

    return res.status(200).json({
      success: true,
      message: "Membership extended successfully",
      member,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Error extending membership",
      error,
    });
  }
};

const getMemberDashboardController = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const filter = {};
    const range = {};
    if (startDate || endDate) {
      filter.createdAt = {};
      if (startDate) {
        const start = parseRangeDate(startDate, false);
        if (start) {
          filter.createdAt.$gte = start;
          range.$gte = start;
        }
      }
      if (endDate) {
        const end = parseRangeDate(endDate, true);
        if (end) {
          filter.createdAt.$lte = end;
          range.$lte = end;
        }
      }
      if (!Object.keys(filter.createdAt).length) delete filter.createdAt;
    }

    const members = await Member.find(filter);
    let expensesInRange = 0;
    let expensesCountInRange = 0;
    const expenseBuckets = {};
    if (range.$gte || range.$lte) {
      const expenseQuery = {};
      expenseQuery.date = {};
      if (range.$gte) expenseQuery.date.$gte = range.$gte;
      if (range.$lte) expenseQuery.date.$lte = range.$lte;
      const expenses = await Expense.find(expenseQuery);
      for (const e of expenses) {
        expensesInRange += Number(e.amount || 0);
        expensesCountInRange += 1;
        const date = e.date ? new Date(e.date) : null;
        if (date && !Number.isNaN(date.getTime())) {
          const key = date.toISOString().slice(0, 10);
          expenseBuckets[key] = (expenseBuckets[key] || 0) + Number(e.amount || 0);
        }
      }
    }
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
      paidInRange: 0,
      paymentsCountInRange: 0,
      membersJoinedInRange: members.length,
      paymentSeries: [],
      membersJoinedSeries: [],
      expensesInRange,
      expensesCountInRange,
      netInRange: 0,
      expenseSeries: [],
    };

    const paymentBuckets = {};
    const joinedBuckets = {};
    for (const m of members) {
      ensurePaymentCycles(m);
      syncMemberPaymentSummary(m);
      if (m.isModified()) {
        await m.save();
      }
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
      const joinedAt = m.createdAt ? new Date(m.createdAt) : null;
      if (joinedAt && !Number.isNaN(joinedAt.getTime())) {
        const key = joinedAt.toISOString().slice(0, 10);
        joinedBuckets[key] = (joinedBuckets[key] || 0) + 1;
      }

      const currentCycle = getCurrentCycle(m);
      const endDate = currentCycle?.endDate ? new Date(currentCycle.endDate) : null;
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

      if (range.$gte || range.$lte) {
        const history = Array.isArray(m.paymentHistory) ? m.paymentHistory : [];
        for (const p of history) {
          if (p.type !== "payment") continue;
          const at = p.at ? new Date(p.at) : null;
          if (!at || Number.isNaN(at.getTime())) continue;
          if (range.$gte && at < range.$gte) continue;
          if (range.$lte && at > range.$lte) continue;
          stats.paidInRange += Number(p.amount || 0);
          stats.paymentsCountInRange += 1;
          const key = at.toISOString().slice(0, 10);
          paymentBuckets[key] = (paymentBuckets[key] || 0) + Number(p.amount || 0);
        }
      }
    }

    if (range.$gte || range.$lte) {
      const start = range.$gte ? new Date(range.$gte) : null;
      const end = range.$lte ? new Date(range.$lte) : null;
      const series = [];
      if (start && end) {
        const cursor = new Date(start);
        while (cursor <= end) {
          const key = cursor.toISOString().slice(0, 10);
          series.push({ date: key, total: paymentBuckets[key] || 0 });
          cursor.setDate(cursor.getDate() + 1);
        }
      } else {
        for (const [date, total] of Object.entries(paymentBuckets)) {
          series.push({ date, total });
        }
        series.sort((a, b) => new Date(a.date) - new Date(b.date));
      }
      stats.paymentSeries = series;
    }

    if (range.$gte || range.$lte) {
      const start = range.$gte ? new Date(range.$gte) : null;
      const end = range.$lte ? new Date(range.$lte) : null;
      const series = [];
      if (start && end) {
        const cursor = new Date(start);
        while (cursor <= end) {
          const key = cursor.toISOString().slice(0, 10);
          series.push({ date: key, total: expenseBuckets[key] || 0 });
          cursor.setDate(cursor.getDate() + 1);
        }
      } else {
        for (const [date, total] of Object.entries(expenseBuckets)) {
          series.push({ date, total });
        }
        series.sort((a, b) => new Date(a.date) - new Date(b.date));
      }
      stats.expenseSeries = series;
    }

    if (range.$gte || range.$lte) {
      const start = range.$gte ? new Date(range.$gte) : null;
      const end = range.$lte ? new Date(range.$lte) : null;
      const series = [];
      if (start && end) {
        const cursor = new Date(start);
        while (cursor <= end) {
          const key = cursor.toISOString().slice(0, 10);
          series.push({ date: key, total: joinedBuckets[key] || 0 });
          cursor.setDate(cursor.getDate() + 1);
        }
      } else {
        for (const [date, total] of Object.entries(joinedBuckets)) {
          series.push({ date, total });
        }
        series.sort((a, b) => new Date(a.date) - new Date(b.date));
      }
      stats.membersJoinedSeries = series;
    }

    stats.netInRange = Number(stats.paidInRange || 0) - Number(stats.expensesInRange || 0);

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
  adjustMemberPaymentHistoryController,
  addMemberPaymentController,
  extendMemberCycleController,
  updateMemberStatusController,
  restartMemberCycleController,
  uploadMemberProfileController,
  updateMemberPaymentStatusController,
  deleteMemberPaymentHistoryController,
};
