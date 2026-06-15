import React, { useState, useEffect } from "react";
import { User, Brand, Category } from "../types.js";
import { ShieldCheck, Plus, Trash, Lock, ShieldAlert, Check, RefreshCw, AlertCircle } from "lucide-react";
import { apiFetch } from "../lib/api.ts";

interface AdminSettingsProps {
  currentUser: User;
}

export default function AdminSettings({ currentUser }: AdminSettingsProps) {
  // Check role authorization: Only "admin" and "leader" have write access
  const isAuthorized = currentUser.role === "admin" || currentUser.role === "leader";

  const [brands, setBrands] = useState<Brand[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Input states
  const [newBrandName, setNewBrandName] = useState("");
  const [addBrandError, setAddBrandError] = useState("");
  const [addBrandSuccess, setAddBrandSuccess] = useState(false);

  const [newCategoryName, setNewCategoryName] = useState("");
  const [addCatError, setAddCatError] = useState("");
  const [addCatSuccess, setAddCatSuccess] = useState(false);

  const fetchSettings = async () => {
    try {
      setLoading(true);
      setError("");
      const [resBrands, resCat] = await Promise.all([
        apiFetch("/api/brands"),
        apiFetch("/api/categories")
      ]);

      if (!resBrands.ok || !resCat.ok) throw new Error("Failed to retrieve CRM dictionary variables and configuration.");

      const b = await resBrands.json();
      const c = await resCat.json();
      setBrands(b);
      setCategories(c);
    } catch (err: any) {
      setError(err.message || "Server connection failed.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isAuthorized) {
      fetchSettings();
    }
  }, [isAuthorized]);

  // Handle adding a brand (POST)
  const handleAddBrand = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newBrandName.trim()) return;

    try {
      setAddBrandError("");
      setAddBrandSuccess(false);

      const res = await apiFetch("/api/brands", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newBrandName.trim() })
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to add brand");
      }

      setNewBrandName("");
      setAddBrandSuccess(true);
      fetchSettings();
      setTimeout(() => setAddBrandSuccess(false), 2000);
    } catch (err: any) {
      setAddBrandError(err.message || "Connection failed");
    }
  };

  // Handle deleting a brand (DELETE)
  const handleDeleteBrand = async (id: string, name: string) => {
    // Basic protection from deleting seed defaults unless requested
    const seedDefaults = ["Talabat", "Noon", "Amazon", "Carrefour"];
    if (seedDefaults.includes(name) && currentUser.role !== "admin") {
      alert("Core seed partner accounts can only be deleted/modified by a system Administrator (Admin).");
      return;
    }

    if (!confirm(`Are you sure you want to delete brand "${name}"?`)) return;

    try {
      const res = await apiFetch(`/api/brands/${id}`, {
        method: "DELETE"
      });

      if (!res.ok) {
        throw new Error("Failed to delete the enterprise brand.");
      }

      fetchSettings();
    } catch (err: any) {
      alert(err.message);
    }
  };

  // Handle adding a category (POST)
  const handleAddCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCategoryName.trim()) return;

    try {
      setAddCatError("");
      setAddCatSuccess(false);

      const res = await apiFetch("/api/categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newCategoryName.trim() })
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to add category");
      }

      setNewCategoryName("");
      setAddCatSuccess(true);
      fetchSettings();
      setTimeout(() => setAddCatSuccess(false), 2000);
    } catch (err: any) {
      setAddCatError(err.message || "Connection failed");
    }
  };

  // Handle deleting a category (DELETE)
  const handleDeleteCategory = async (id: string, name: string) => {
    if (!confirm(`Are you sure you want to delete category "${name}"?`)) return;

    try {
      const res = await apiFetch(`/api/categories/${id}`, {
        method: "DELETE"
      });

      if (!res.ok) {
        throw new Error("Failed to delete issue category.");
      }

      fetchSettings();
    } catch (err: any) {
      alert(err.message);
    }
  };

  // Lock interface overlay for standard non-authorized Agents
  if (!isAuthorized) {
    return (
      <div className="max-w-xl mx-auto p-8 bg-[#121214] border border-[#27272a] rounded-3xl text-center space-y-4 shadow-xl animate-fade-in my-10">
        <div className="w-16 h-16 bg-rose-500/10 text-rose-455 rounded-full flex items-center justify-center mx-auto border border-rose-500/20">
          <Lock className="w-8 h-8 stroke-[2.5]" />
        </div>
        <h3 className="text-md font-extrabold text-white">Restricted Area Access</h3>
        <p className="text-xs text-zinc-400 font-light leading-relaxed">
          Access Denied: Managing custom CRM Brands or Issue Categories requires specialized system authorization belonging to either <strong className="text-blue-400">Team Leader</strong> or <strong className="text-blue-400">Admin</strong> privilege roles.
        </p>
        <div className="p-3.5 bg-[#0a0a0b] rounded-2xl border border-[#27272a] text-[11px] text-zinc-500 font-mono">
          Active Account Identity: {currentUser.name} ({currentUser.role.toUpperCase()})
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8 animate-fade-in text-[#e4e4e7]">
      
      {/* Title block */}
      <div className="bg-[#121214] p-5 border border-[#27272a] shadow-lg rounded-3xl flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-blue-500/10 text-blue-400 rounded-2xl">
            <ShieldCheck className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-md font-extrabold text-white">CRM Domain Taxonomy Controls</h2>
            <p className="text-xs text-zinc-400 font-light mt-0.5">
              Manage taxonomy fields used across logging forms and the AI classification engine for all team members.
            </p>
          </div>
        </div>

        <button
          onClick={fetchSettings}
          className="p-3 text-zinc-400 hover:text-blue-405 bg-[#0a0a0b] hover:bg-[#121214] border border-[#27272a] rounded-2xl active:scale-95 transition"
          title="Refresh Data"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {error && (
        <div className="p-4 bg-rose-950/20 border border-rose-500/20 rounded-3xl text-sm text-rose-450">
          {error}
        </div>
      )}

      {/* Grid forms column */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        
        {/* Brand partners management view */}
        <div className="bg-[#121214] p-6 border border-[#27272a] shadow-lg rounded-3xl space-y-6">
          <div>
            <h3 className="text-sm font-extrabold text-white">1. Manage Enterprise Brands</h3>
            <p className="text-xs text-[#71717a] mt-1 font-light">Configure external brands, affiliate portals, or remove active partnerships.</p>
          </div>

          <form onSubmit={handleAddBrand} className="flex gap-2">
            <input
              type="text"
              required
              value={newBrandName}
              onChange={(e) => setNewBrandName(e.target.value)}
              placeholder="Brand Name (e.g., Uber)"
              className="flex-1 px-4 py-2 bg-[#0a0a0b] border border-[#27272a] rounded-2xl text-xs font-bold text-white placeholder-zinc-650 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
            <button
              type="submit"
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-2xl text-xs font-bold transition flex items-center gap-1 shrink-0 shadow shadow-blue-600/10 active:scale-95"
            >
              <Plus className="w-4 h-4" />
              Add
            </button>
          </form>

          {addBrandError && (
            <div className="text-[11px] text-rose-405 flex items-center gap-1 font-bold">
              <AlertCircle className="w-3.5 h-3.5" />
              {addBrandError}
            </div>
          )}

          {addBrandSuccess && (
            <div className="text-[11px] text-emerald-450 flex items-center gap-1 font-bold">
              <Check className="w-3.5 h-3.5" />
              Successfully registered in CRM parameters!
            </div>
          )}

          <div className="space-y-2 max-h-[300px] overflow-y-auto w-full">
            {brands.map((b) => (
              <div
                key={b.id}
                className="flex items-center justify-between p-3 bg-[#0a0a0b] border border-[#27272a]/70 rounded-2xl text-xs hover:bg-zinc-800/10 transition"
              >
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-blue-500"></span>
                  <span className="font-extrabold text-zinc-350">{b.brand_name}</span>
                </div>
                <button
                  type="button"
                  onClick={() => handleDeleteBrand(b.id, b.brand_name)}
                  className="p-1 px-2.5 text-rose-450 hover:bg-rose-500/10 rounded-xl transition font-bold flex items-center gap-1"
                >
                  <Trash className="w-3.5 h-3.5" />
                  Delete
                </button>
              </div>
            ))}
            {brands.length === 0 && !loading && (
              <div className="text-center py-6 text-zinc-500 text-xs">No brands currently defined.</div>
            )}
          </div>
        </div>

        {/* Categories management view */}
        <div className="bg-[#121214] p-6 border border-[#27272a] shadow-lg rounded-3xl space-y-6">
          <div>
            <h3 className="text-sm font-extrabold text-white">2. Manage Case Categories</h3>
            <p className="text-xs text-[#71717a] mt-1 font-light">Create classification terms used across logging forms and reporting telemetry.</p>
          </div>

          <form onSubmit={handleAddCategory} className="flex gap-2">
            <input
              type="text"
              required
              value={newCategoryName}
              onChange={(e) => setNewCategoryName(e.target.value)}
              placeholder="Category (e.g. App Crash)"
              className="flex-1 px-4 py-2 bg-[#0a0a0b] border border-[#27272a] rounded-2xl text-xs font-bold text-white placeholder-zinc-650 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
            <button
              type="submit"
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-2xl text-xs font-bold transition flex items-center gap-1 shrink-0 shadow shadow-blue-600/10 active:scale-95"
            >
              <Plus className="w-4 h-4" />
              Add
            </button>
          </form>

          {addCatError && (
            <div className="text-[11px] text-rose-455 flex items-center gap-1 font-bold">
              <AlertCircle className="w-3.5 h-3.5" />
              {addCatError}
            </div>
          )}

          {addCatSuccess && (
            <div className="text-[11px] text-emerald-455 flex items-center gap-1 font-bold">
              <Check className="w-3.5 h-3.5" />
              Successfully added to category list!
            </div>
          )}

          <div className="space-y-2 max-h-[300px] overflow-y-auto w-full">
            {categories.map((c) => (
              <div
                key={c.id}
                className="flex items-center justify-between p-3 bg-[#0a0a0b] border border-[#27272a]/70 rounded-2xl text-xs hover:bg-zinc-800/10 transition"
              >
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-500"></span>
                  <span className="font-extrabold text-zinc-350">{c.category_name}</span>
                </div>
                <button
                  type="button"
                  onClick={() => handleDeleteCategory(c.id, c.category_name)}
                  className="p-1 px-2.5 text-rose-455 hover:bg-rose-500/10 rounded-xl transition font-bold flex items-center gap-1"
                >
                  <Trash className="w-3.5 h-3.5" />
                  Delete
                </button>
              </div>
            ))}
            {categories.length === 0 && !loading && (
              <div className="text-center py-6 text-zinc-500 text-xs">No categories currently defined.</div>
            )}
          </div>
        </div>

      </div>

    </div>
  );
}
