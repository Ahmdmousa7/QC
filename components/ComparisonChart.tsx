import React from 'react';
import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid } from 'recharts';
import { ComparisonSummary, ComparisonStatus } from '../types';

interface Props {
  summary: ComparisonSummary;
}

const COLORS = {
  MATCH: '#22c55e', // green-500
  MISMATCH: '#eab308', // yellow-500
  MISSING1: '#3b82f6', // blue-500
  MISSING2: '#ef4444', // red-500
};

export const ComparisonChart: React.FC<Props> = ({ summary }) => {
  const pieData = [
    { name: 'Exact Match', value: summary.matches, color: COLORS.MATCH },
    { name: 'Mismatch', value: summary.mismatches, color: COLORS.MISMATCH },
    { name: 'Unique to File 2', value: summary.missingIn1, color: COLORS.MISSING1 },
    { name: 'Unique to File 1', value: summary.missingIn2, color: COLORS.MISSING2 },
  ].filter(d => d.value > 0);

  // Calculate mismatches by column
  const mismatchesByColumn: Record<string, number> = {};
  summary.results?.forEach(r => {
    if (r.status === ComparisonStatus.MISMATCH && r.differences) {
      r.differences?.forEach(diff => {
        mismatchesByColumn[diff] = (mismatchesByColumn[diff] || 0) + 1;
      });
    }
  });

  const columnDiffData = Object.entries(mismatchesByColumn)
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 10); // Top 10 columns with most differences

  return (
    <div className="space-y-6 mb-8">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200 h-80 flex flex-col">
          <h3 className="text-lg font-semibold text-slate-800 mb-4 shrink-0">Overall Distribution</h3>
          <div className="flex-1 min-h-0 w-full relative">
            <div className="absolute inset-0">
              <ResponsiveContainer width="100%" height="100%" minWidth={1} minHeight={1}>
                <PieChart>
                  <Pie
                    data={pieData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={80}
                    paddingAngle={5}
                    dataKey="value"
                  >
                    {pieData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip />
                  <Legend verticalAlign="bottom" height={36}/>
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200 h-80 flex flex-col">
          <h3 className="text-lg font-semibold text-slate-800 mb-4 shrink-0">Discrepancy Breakdown</h3>
          <div className="flex-1 min-h-0 w-full relative">
            <div className="absolute inset-0">
              <ResponsiveContainer width="100%" height="100%" minWidth={1} minHeight={1}>
                <BarChart
                  data={pieData}
                  layout="vertical"
                  margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
                >
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                  <XAxis type="number" />
                  <YAxis dataKey="name" type="category" width={100} tick={{fontSize: 12}} />
                  <Tooltip />
                  <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                    {pieData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      </div>

      {columnDiffData.length > 0 && (
        <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200 h-80 flex flex-col">
          <h3 className="text-lg font-semibold text-slate-800 mb-4 shrink-0">Top Mismatches by Column</h3>
          <div className="flex-1 min-h-0 w-full relative">
            <div className="absolute inset-0">
              <ResponsiveContainer width="100%" height="100%" minWidth={1} minHeight={1}>
                <BarChart
                  data={columnDiffData}
                  margin={{ top: 5, right: 30, left: 20, bottom: 25 }}
                >
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="name" tick={{fontSize: 12}} angle={-45} textAnchor="end" />
                  <YAxis type="number" />
                  <Tooltip />
                  <Bar dataKey="value" fill="#8b5cf6" radius={[4, 4, 0, 0]} name="Mismatches" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
