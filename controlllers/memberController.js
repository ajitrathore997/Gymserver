import Member from "../models/Member.js";
import { User } from "../models/User.js";
import Expense from "../models/Expense.js";

const MONTH_ALLOCATION_POLICY =
  process.env.MONTH_ALLOCATION_POLICY === "calendar_month"
    ? "calendar_month"
    : "cycle_window";

const ALLOWED_DURATIONS = new Set(["1 Month", "3 Months", "6 Months", "1 Year"]);

const normalizeDuration = (duration, { allowUndefined = true } = {}) => {
  if ((duration === undefined || duration === null || duration === "") && allowUndefined) {
    return undefined;
  }
  const raw = String(duration).trim().toLowerCase();
  if (raw === "1" || raw === "1 month" || raw === "month" || raw === "monthly") {
    return "1 Month";
  }
  if (raw === "3" || raw === "3 month" || raw === "3 months") {
    return "3 Months";
  }
  if (raw === "6" || raw === "6 month" || raw === "6 months") {
    return "6 Months";
  }
  if (
    raw === "12" ||
    raw === "12 month" ||
    raw === "12 months" ||
    raw === "1 year" ||
    raw === "yearly"
  ) {
    return "1 Year";
  }
  throw new Error("Invalid duration. Allowed values: 1 Month, 3 Months, 6 Months, 1 Year");
};

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

const toMonthStart = (dateValue) => {
  const d = new Date(dateValue);
  if (Number.isNaN(d.getTime())) return null;
  return new Date(d.getFullYear(), d.getMonth(), 1);
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
  const targetMonth = toMonthStart(parsePaymentMonth(paymentMonthLabel));
  if (!targetMonth) return null;

  ensurePaymentCycles(member);
  const cycles = member.paymentCycles || [];

  while (true) {
    const matchIndex = cycles.findIndex((cycle) => {
      const start = toMonthStart(cycle?.startDate);
      const end = toMonthStart(cycle?.endDate);
      if (!start) return false;
      if (MONTH_ALLOCATION_POLICY === "calendar_month") {
        return (
          targetMonth.getFullYear() === start.getFullYear() &&
          targetMonth.getMonth() === start.getMonth()
        );
      }
      if (!end) return false;
      return targetMonth >= start && targetMonth < end;
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
    const nextCycleMonths = Math.max(Number(last.cycleMonths || 1), 1);
    const nextFee = Number(last.fee ?? member.fee ?? 0);
    cycles.push(buildCycle(nextStart, nextCycleMonths, nextFee));
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

const calculateOverdueCycles = (cycle, now = new Date()) => {
  if (!cycle?.endDate) return 0;
  const endDate = new Date(cycle.endDate);
  if (Number.isNaN(endDate.getTime()) || endDate >= now) return 0;
  const cycleMonths = Math.max(Number(cycle.cycleMonths || 1), 1);
  let count = 0;
  let cursor = new Date(endDate);
  while (cursor < now) {
    count += 1;
    cursor = addMonths(cursor, cycleMonths);
    if (!cursor) break;
  }
  return count;
};

const shiftDateByMs = (value, diffMs) => {
  if (!value) return value;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  d.setTime(d.getTime() + diffMs);
  return d;
};

const refreshReminderState = (member) => {
  if (Number(member.remainingAmount || 0) <= 0) {
    member.reminderStatus = "None";
    member.promisedPaymentDate = null;
    return;
  }
  const pendingWithPromise = (member.paymentHistory || [])
    .filter(
      (p) => p?.type === "payment" && p?.paymentStatus === "Pending" && p?.promiseDate
    )
    .sort((a, b) => new Date(b.promiseDate) - new Date(a.promiseDate))[0];
  if (pendingWithPromise?.promiseDate) {
    member.reminderStatus = "Promised";
    member.promisedPaymentDate = pendingWithPromise.promiseDate;
  } else if (member.reminderStatus === "Promised") {
    member.reminderStatus = "None";
    member.promisedPaymentDate = null;
  }
};

const createMemberController = async (req, res) => {
  try {
    const activationDate = req.body.activationDate || req.body.startDate;
    if (!activationDate) {
      return res.status(400).json({
        success: false,
        message: "activationDate is required",
      });
    }
    const registrationDate = req.body.registrationDate || new Date();
    const normalizedDuration = normalizeDuration(req.body.duration);
    const fee = Number(req.body.fee || 0);
    const paidAmount = Number(req.body.paidAmount || 0);
    const paymentStatus =
      req.body.paymentStatus === "Free Trial" && fee === 0
        ? "Free Trial"
        : "Pending";

    const actor = await getActorFromRequest(req);

    const email = req.body.email ? String(req.body.email).trim().toLowerCase() : "";
    const phone = req.body.phone ? String(req.body.phone).trim() : "";
    if (phone || email) {
      const duplicate = await Member.findOne({
        $or: [
          ...(phone ? [{ phone }] : []),
          ...(email ? [{ email }] : []),
        ],
      }).select("name phone email");
      if (duplicate) {
        return res.status(409).json({
          success: false,
          message: "Member with same phone/email already exists",
          duplicate,
        });
      }
    }

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
      duration: normalizedDuration || "1 Month",
      activationDate,
      registrationDate,
      startDate: activationDate,
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
    if (error?.message?.toLowerCase?.().includes("invalid duration")) {
      return res.status(400).json({
        success: false,
        message: error.message,
      });
    }
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

    const requestedPaymentStatus = paymentStatus || null;
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

    const minRemainingNum =
      minRemaining !== undefined && minRemaining !== null && minRemaining !== ""
        ? Number(minRemaining)
        : null;
    const maxRemainingNum =
      maxRemaining !== undefined && maxRemaining !== null && maxRemaining !== ""
        ? Number(maxRemaining)
        : null;
    addRangeQuery(query, 'fee', minFee, maxFee);
    addRangeQuery(query, 'paidAmount', minPaid, maxPaid);


    if (startFrom || startTo) {
      query.activationDate = {};
      if (startFrom) {
        const start = parseRangeDate(startFrom, false);
        if (start) query.activationDate.$gte = start;
      }
      if (startTo) {
        const end = parseRangeDate(startTo, true);
        if (end) query.activationDate.$lte = end;
      }
      if (!Object.keys(query.activationDate).length) delete query.activationDate;
    }

    const safeSortFields = new Set([
      "createdAt",
      "name",
      "fee",
      "paidAmount",
      "remainingAmount",
      "startDate",
      "activationDate",
      "registrationDate",
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
        if (!m.activationDate && m.startDate) {
          m.activationDate = m.startDate;
        }
        if (!m.registrationDate && m.createdAt) {
          m.registrationDate = m.createdAt;
        }
        syncMemberPaymentSummary(m);
        if (m.isModified()) {
          await m.save();
        }
        const obj = m.toObject();
        const activationDate = obj.activationDate || obj.startDate || null;
        const registrationDate = obj.registrationDate || obj.createdAt || null;
        const history = Array.isArray(obj.paymentHistory) ? obj.paymentHistory : [];
        const lastPayment = history.length ? history[history.length - 1] : null;
        const currentCycle = getCurrentCycle(obj);
        const expiryDate = currentCycle?.endDate || null;
        const expiry = expiryDate ? new Date(expiryDate) : null;
        const isExpired = expiry ? expiry < now : false;
        const storedRemaining = Number(obj.remainingAmount || 0);
        const overdueCycles =
          obj.memberStatus === "Active" && currentCycle
            ? calculateOverdueCycles(currentCycle, now)
            : 0;
        const overdueCycleFee = Number((currentCycle?.fee ?? obj.fee) || 0);
        const dueForExpiredPaidCycle =
          obj.memberStatus === "Active" && overdueCycles > 0
            ? overdueCycleFee * overdueCycles
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
          activationDate,
          registrationDate,
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
      const dueAmount = Number(m.dueNowAmount || 0);
      if (minRemainingNum !== null && dueAmount < minRemainingNum) return false;
      if (maxRemainingNum !== null && dueAmount > maxRemainingNum) return false;

      if (requestedPaymentStatus) {
        const effectiveStatus = m.displayPaymentStatus || m.paymentStatus;
        if (effectiveStatus !== requestedPaymentStatus) return false;
      }

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
    if (!member.activationDate && member.startDate) {
      member.activationDate = member.startDate;
    }
    if (!member.registrationDate && member.createdAt) {
      member.registrationDate = member.createdAt;
    }
    syncMemberPaymentSummary(member);
    refreshReminderState(member);
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
    const overdueCycles =
      member.memberStatus === "Active" && currentCycle
        ? calculateOverdueCycles(currentCycle, new Date())
        : 0;
    const overdueCycleFee = Number((currentCycle?.fee ?? member.fee) || 0);
    const dueForExpiredPaidCycle =
      member.memberStatus === "Active" && overdueCycles > 0
        ? overdueCycleFee * overdueCycles
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

    const normalizedDuration =
      req.body.duration !== undefined ? normalizeDuration(req.body.duration, { allowUndefined: false }) : undefined;

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
    addIfChanged(
      "registrationDate",
      member.registrationDate,
      req.body.registrationDate
    );
    addIfChanged(
      "activationDate",
      member.activationDate,
      req.body.activationDate
    );
    addIfChanged("startDate", member.startDate, req.body.startDate);
    addIfChanged("duration", member.duration, normalizedDuration);
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

    if (req.body.registrationDate !== undefined)
      member.registrationDate = req.body.registrationDate;
    const oldActivationDate = member.activationDate
      ? new Date(member.activationDate)
      : member.startDate
      ? new Date(member.startDate)
      : null;

    if (req.body.activationDate !== undefined) {
      member.activationDate = req.body.activationDate;
      member.startDate = req.body.activationDate;
    }
    if (req.body.startDate !== undefined) {
      member.startDate = req.body.startDate;
      if (req.body.activationDate === undefined) {
        member.activationDate = req.body.startDate;
      }
    }
    const shouldRealignCycles =
      Boolean(req.body.realignCyclesOnActivationChange) &&
      oldActivationDate &&
      member.activationDate &&
      new Date(member.activationDate).getTime() !== oldActivationDate.getTime();
    if (shouldRealignCycles) {
      const nextActivation = new Date(member.activationDate);
      const diffMs = nextActivation.getTime() - oldActivationDate.getTime();
      if (!Number.isNaN(diffMs)) {
        if (Array.isArray(member.paymentCycles)) {
          member.paymentCycles.forEach((cycle) => {
            cycle.startDate = shiftDateByMs(cycle.startDate, diffMs);
            cycle.endDate = shiftDateByMs(cycle.endDate, diffMs);
          });
        }
        if (Array.isArray(member.paymentHistory)) {
          member.paymentHistory.forEach((entry) => {
            if (Array.isArray(entry.allocations)) {
              entry.allocations.forEach((alloc) => {
                alloc.startDate = shiftDateByMs(alloc.startDate, diffMs);
                alloc.endDate = shiftDateByMs(alloc.endDate, diffMs);
              });
            }
          });
        }
      }
    }
    if (normalizedDuration !== undefined) member.duration = normalizedDuration;
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
    refreshReminderState(member);

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
    if (error?.message?.toLowerCase?.().includes("invalid duration")) {
      return res.status(400).json({
        success: false,
        message: error.message,
      });
    }
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

    const {
      historyIndex,
      newAmount,
      note,
      paymentMonth,
      paymentMode,
      date,
      paymentStatus,
      promiseDate,
      adjustmentAmount,
    } = req.body;

    ensurePaymentCycles(member);
    const actor = await getActorFromRequest(req);

    if (historyIndex === undefined) {
      const delta = Number(adjustmentAmount || 0);
      if (!Number.isFinite(delta) || delta === 0) {
        return res.status(400).json({
          success: false,
          message: "Provide historyIndex for edit or non-zero adjustmentAmount for manual adjustment",
        });
      }

      let allocations = [];
      if (delta > 0) {
        const applied = applyPaymentToCycles(
          member,
          delta,
          actor,
          note,
          new Date(),
          "adjustment"
        );
        allocations = applied.allocations;
      } else {
        applyAdjustmentToCurrentCycle(member, delta, actor, note, new Date());
      }
      syncMemberPaymentSummary(member);
      refreshReminderState(member);
      member.paymentHistory.push({
        amount: delta,
        type: "adjustment",
        fee: member.fee,
        paidAmount: member.paidAmount,
        remainingAmount: member.remainingAmount,
        paymentStatus: member.paymentStatus,
        by: actor,
        at: new Date(),
        note: note || "Manual adjustment",
        paymentMonth: paymentMonth,
        paymentMode: paymentMode || "Cash",
        allocations,
      });
      await member.save();
      return res.status(200).json({
        success: true,
        message: "Manual adjustment added",
        member,
      });
    }
    const index = Number(historyIndex);
    if (!Array.isArray(member.paymentHistory) || !member.paymentHistory[index]) {
      return res.status(404).json({
        success: false,
        message: "Payment history entry not found",
      });
    }
    const entry = member.paymentHistory[index];

    let result = { delta: 0, allocations: [] };
    if (newAmount !== undefined) {
      const targetAmount = Number(newAmount);
      if (!Number.isFinite(targetAmount) || targetAmount < 0) {
        return res.status(400).json({
          success: false,
          message: "newAmount must be a valid number and >= 0",
        });
      }

      const oldAmount = Number(entry.amount || 0);
      const delta = targetAmount - oldAmount;
      if (delta !== 0 && entry.type === "payment") {
        result = adjustPaymentHistoryEntry(
          member,
          index,
          targetAmount,
          actor,
          note
        );
      } else {
        entry.amount = targetAmount;
      }
    }

    if (note !== undefined) entry.note = note;
    if (paymentMonth !== undefined) entry.paymentMonth = paymentMonth;
    if (paymentMode !== undefined) entry.paymentMode = paymentMode;
    if (paymentStatus !== undefined) entry.paymentStatus = paymentStatus;
    if (date !== undefined) {
      const parsedAt = new Date(date);
      if (!Number.isNaN(parsedAt.getTime())) {
        entry.at = parsedAt;
      }
    }
    if (promiseDate !== undefined) {
      if (!promiseDate) {
        entry.promiseDate = undefined;
      } else {
        const parsedPromise = new Date(promiseDate);
        if (!Number.isNaN(parsedPromise.getTime())) {
          entry.promiseDate = parsedPromise;
        }
      }
    }

    syncMemberPaymentSummary(member);
    refreshReminderState(member);
    refreshReminderState(member);
    refreshReminderState(member);

    if (result.delta !== 0) {
      member.paymentHistory.push({
        amount: result.delta,
        type: "adjustment",
        fee: member.fee,
        paidAmount: member.paidAmount,
        remainingAmount: member.remainingAmount,
        paymentStatus: member.paymentStatus,
        by: actor,
        at: new Date(),
        note: note || "Manual admin payment edit",
        paymentMonth: paymentMonth,
        paymentMode: paymentMode || "Cash",
        allocations: result.allocations,
      });
    }

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
    syncMemberPaymentSummary(member);
    refreshReminderState(member);
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
    refreshReminderState(member);

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
    if (!member.activationDate && member.startDate) {
      member.activationDate = member.startDate;
    }
    if (!member.registrationDate && member.createdAt) {
      member.registrationDate = member.createdAt;
    }
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
      if (req.body.promiseDate) {
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
      }
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

    refreshReminderState(member);

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

  const nextDuration = normalizeDuration(options.duration || member.duration, {
    allowUndefined: false,
  });
  const nextFee =
    options.fee !== undefined ? Number(options.fee) : Number(member.fee || 0);
  const cycleMonths = getDurationMonths(nextDuration);
  const includePreviousDue = Boolean(options.includePreviousDue);
  const shouldClearPreviousDue = !includePreviousDue;

  ensurePaymentCycles(member);
  if (shouldClearPreviousDue) {
    for (const cycle of member.paymentCycles || []) {
      if (Number(cycle.remainingAmount || 0) > 0) {
        cycle.remainingAmount = 0;
        cycle.status = "Paid";
        cycle.paidAmount = Number(cycle.fee || 0);
      }
    }
  }

  member.duration = nextDuration;
  member.fee = nextFee;
  member.startDate = startDate;
  member.activationDate = startDate;
  member.memberStatus = "Active";
  if (shouldClearPreviousDue) {
    member.reminderStatus = "None";
    member.promisedPaymentDate = null;
  }

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
      includePreviousDue: req.body.includePreviousDue,
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
        includePreviousDue: Boolean(req.body.includePreviousDue),
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
    const startFreshCycle = Boolean(req.body.startFreshCycle);

    if (oldStatus === "Inactive" && memberStatus === "Active" && startFreshCycle) {
      startFreshMemberCycle(member, {
        startDate: req.body.startDate,
        duration: req.body.duration,
        fee: req.body.fee,
        includePreviousDue: req.body.includePreviousDue,
      });
      member.inactiveSince = null;
    } else if (oldStatus === "Inactive" && memberStatus === "Active") {
      // Resume: preserve current cycle and extend by paused duration.
      ensurePaymentCycles(member);
      const currentCycle = getCurrentCycle(member);
      if (currentCycle?.endDate && member.inactiveSince) {
        const pauseStart = new Date(member.inactiveSince);
        const now = new Date();
        if (!Number.isNaN(pauseStart.getTime()) && now > pauseStart) {
          const pausedMs = now.getTime() - pauseStart.getTime();
          const nextEnd = new Date(currentCycle.endDate);
          nextEnd.setTime(nextEnd.getTime() + pausedMs);
          currentCycle.endDate = nextEnd;
        }
      }
      member.memberStatus = "Active";
      member.inactiveSince = null;
      syncMemberPaymentSummary(member);
    } else if (oldStatus === "Active" && memberStatus === "Inactive") {
      member.memberStatus = "Inactive";
      member.inactiveSince = new Date();
      syncMemberPaymentSummary(member);
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
        oldStatus === "Inactive" && memberStatus === "Active" && startFreshCycle
          ? "Member reactivated with fresh cycle"
          : oldStatus === "Inactive" && memberStatus === "Active"
          ? "Member reactivated and previous cycle resumed"
          : "Member status updated",
      member,
    });
  } catch (error) {
    if (error?.message?.toLowerCase?.().includes("invalid")) {
      return res.status(400).json({
        success: false,
        message: error.message,
      });
    }
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
    const range = {};
    if (startDate || endDate) {
      if (startDate) {
        const start = parseRangeDate(startDate, false);
        if (start) {
          range.$gte = start;
        }
      }
      if (endDate) {
        const end = parseRangeDate(endDate, true);
        if (end) {
          range.$lte = end;
        }
      }
    }

    const members = await Member.find({});
    const inRange = (date) => {
      if (!date || Number.isNaN(date.getTime())) return false;
      if (range.$gte && date < range.$gte) return false;
      if (range.$lte && date > range.$lte) return false;
      return true;
    };
    const scopedMembers =
      range.$gte || range.$lte
        ? members.filter((m) => {
            const effectiveActivation = m.activationDate
              ? new Date(m.activationDate)
              : m.startDate
              ? new Date(m.startDate)
              : m.createdAt
              ? new Date(m.createdAt)
              : null;
            return inRange(effectiveActivation);
          })
        : members;
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
      totalMembers: scopedMembers.length,
      totalFee: 0,
      totalPaid: 0,
      totalRemaining: 0,
      totalDueNow: 0,
      pendingCount: 0,
      overdueMembersCount: 0,
      promisedMembersCount: 0,
      promisedDueAmount: 0,
      dueNextWeekCount: 0,
      paymentStatusCounts: { Paid: 0, Pending: 0, "Free Trial": 0 },
      membershipTypeCounts: {},
      dueNextWeekMembers: [],
      defaulters: [],
      paidInRange: 0,
      paymentsCountInRange: 0,
      membersJoinedInRange: scopedMembers.length,
      paymentSeries: [],
      membersJoinedSeries: [],
      expensesInRange,
      expensesCountInRange,
      netInRange: 0,
      expenseSeries: [],
    };

    const paymentBuckets = {};
    const joinedBuckets = {};

    if (range.$gte || range.$lte) {
      for (const m of members) {
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
    for (const m of scopedMembers) {
      ensurePaymentCycles(m);
      syncMemberPaymentSummary(m);
      if (m.isModified()) {
        await m.save();
      }
      const fee = Number(m.fee || 0);
      const paid = Number(m.paidAmount || 0);
      const currentCycle = getCurrentCycle(m);
      const overdueCycles =
        m.memberStatus === "Active" && currentCycle
          ? calculateOverdueCycles(currentCycle, now)
          : 0;
      const overdueCycleFee = Number((currentCycle?.fee ?? m.fee) || 0);
      const remaining =
        (m.remainingAmount ?? Math.max(fee - paid, 0)) +
        (overdueCycles > 0 ? overdueCycleFee * overdueCycles : 0);
      const isOverdue = overdueCycles > 0;
      const isPromised = m.reminderStatus === "Promised";

      stats.totalFee += fee;
      stats.totalPaid += paid;
      stats.totalRemaining += remaining;
      stats.totalDueNow += remaining;

      if (remaining > 0) stats.pendingCount += 1;
      if (isOverdue) stats.overdueMembersCount += 1;
      if (isPromised) {
        stats.promisedMembersCount += 1;
        stats.promisedDueAmount += remaining;
      }

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
      const joinedAt = m.registrationDate
        ? new Date(m.registrationDate)
        : (m.createdAt ? new Date(m.createdAt) : null);
      if (joinedAt && !Number.isNaN(joinedAt.getTime())) {
        const key = joinedAt.toISOString().slice(0, 10);
        joinedBuckets[key] = (joinedBuckets[key] || 0) + 1;
      }

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
      if (remaining > 0 && isOverdue) {
        const promisedDate = m.promisedPaymentDate
          ? new Date(m.promisedPaymentDate)
          : null;
        stats.defaulters.push({
          _id: m._id,
          name: m.name,
          phone: m.phone,
          dueAmount: remaining,
          endDate: endDate || null,
          promisedPaymentDate:
            promisedDate && !Number.isNaN(promisedDate.getTime())
              ? promisedDate
              : null,
        });
      }

      // paidInRange is intentionally aggregated across all members above.
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
    stats.totalDueNow = Number(stats.totalDueNow || 0);
    stats.promisedDueAmount = Number(stats.promisedDueAmount || 0);

    stats.defaulters.sort((a, b) => Number(b.dueAmount || 0) - Number(a.dueAmount || 0));
    stats.defaulters = stats.defaulters.slice(0, 12);

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
