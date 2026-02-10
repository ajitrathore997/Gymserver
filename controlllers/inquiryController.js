import Inquiry from "../models/Inquiry.js";
import { User } from "../models/User.js";

const getActorFromRequest = async (req) => {
  if (!req?.user?._id) return { id: null, name: "System" };
  const user = await User.findById(req.user._id).select("name");
  return {
    id: user?._id || req.user._id,
    name: user?.name || "Unknown",
  };
};

const createInquiryController = async (req, res) => {
  try {
    const { name, phone, email, source, status, nextFollowUpDate, note } = req.body;
    if (!name || !phone) {
      return res.status(400).json({
        success: false,
        message: "name and phone are required",
      });
    }
    const actor = await getActorFromRequest(req);
    const inquiry = await new Inquiry({
      name,
      phone,
      email,
      source,
      status,
      nextFollowUpDate: nextFollowUpDate ? new Date(nextFollowUpDate) : undefined,
      note,
      createdBy: actor,
      updatedBy: actor,
    }).save();
    return res.status(201).json({
      success: true,
      message: "Inquiry created",
      inquiry,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Error creating inquiry",
      error,
    });
  }
};

const getInquiriesController = async (req, res) => {
  try {
    const { status, search, page = 1, limit = 20 } = req.query;
    const query = {};
    if (status) query.status = status;
    if (search) {
      const regex = new RegExp(search, "i");
      query.$or = [{ name: regex }, { phone: regex }, { email: regex }];
    }

    const pageNum = Math.max(Number(page) || 1, 1);
    const limitNum = Math.min(Math.max(Number(limit) || 20, 1), 100);
    const skip = (pageNum - 1) * limitNum;

    const [inquiries, total] = await Promise.all([
      Inquiry.find(query).sort({ createdAt: -1 }).skip(skip).limit(limitNum),
      Inquiry.countDocuments(query),
    ]);

    return res.status(200).json({
      success: true,
      inquiries,
      page: pageNum,
      limit: limitNum,
      total,
      totalPages: Math.ceil(total / limitNum),
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Error getting inquiries",
      error,
    });
  }
};

const updateInquiryController = async (req, res) => {
  try {
    const inquiry = await Inquiry.findById(req.params.id);
    if (!inquiry) {
      return res.status(404).json({
        success: false,
        message: "Inquiry not found",
      });
    }

    const { name, phone, email, source, status, nextFollowUpDate, note, lastContactedAt, followUp } = req.body;
    if (name !== undefined) inquiry.name = name;
    if (phone !== undefined) inquiry.phone = phone;
    if (email !== undefined) inquiry.email = email;
    if (source !== undefined) inquiry.source = source;
    if (status !== undefined) inquiry.status = status;
    if (nextFollowUpDate !== undefined)
      inquiry.nextFollowUpDate = nextFollowUpDate ? new Date(nextFollowUpDate) : undefined;
    if (lastContactedAt !== undefined)
      inquiry.lastContactedAt = lastContactedAt ? new Date(lastContactedAt) : undefined;
    if (note !== undefined) inquiry.note = note;

    const actor = await getActorFromRequest(req);
    inquiry.updatedBy = actor;

    if (followUp) {
      inquiry.followUps = Array.isArray(inquiry.followUps) ? inquiry.followUps : [];
      inquiry.followUps.push({
        date: followUp.date ? new Date(followUp.date) : undefined,
        note: followUp.note,
        status: followUp.status || "Planned",
        by: actor,
        createdAt: new Date(),
      });
    }

    await inquiry.save();
    return res.status(200).json({
      success: true,
      message: "Inquiry updated",
      inquiry,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Error updating inquiry",
      error,
    });
  }
};

const deleteInquiryController = async (req, res) => {
  try {
    const inquiry = await Inquiry.findByIdAndDelete(req.params.id);
    if (!inquiry) {
      return res.status(404).json({
        success: false,
        message: "Inquiry not found",
      });
    }
    return res.status(200).json({
      success: true,
      message: "Inquiry deleted",
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Error deleting inquiry",
      error,
    });
  }
};

export {
  createInquiryController,
  getInquiriesController,
  updateInquiryController,
  deleteInquiryController,
};
