const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '..', 'app', 'dashboard', 'creation', 'page.tsx');
let content = fs.readFileSync(filePath, 'utf8');

const target = `                      {uploadedRefUrl && (
                         <button 
                             onClick={(e) => { e.stopPropagation(); setUploadedRefUrl(null); }}
                             className="absolute -top-1.5 -right-1.5 bg-slate-800 text-white rounded-full p-1 shadow-md hover:bg-slate-700 transition-colors"
                         >
                             <X size={10} />
                          </button>
                      )}
                 </div>`;

content = content.replace(/\r\n/g, '\n');
const normalizedTarget = target.replace(/\r\n/g, '\n');

const replacement = `                      {uploadedRefUrl && (
                         <button 
                             onClick={(e) => { e.stopPropagation(); setUploadedRefUrl(null); }}
                             className="absolute -top-1.5 -right-1.5 bg-slate-800 text-white rounded-full p-1 shadow-md hover:bg-slate-700 transition-colors"
                         >
                             <X size={10} />
                          </button>
                      )}
                 </div>

                 {/* Map user's personal reference library creatives */}
                 {userReferences.map(ref => (
                      <button 
                         key={ref.id}
                         onClick={() => { 
                           setSelectedTemplate(null); 
                           setUploadedRefUrl(null); 
                           setSelectedUserRefId(ref.id); 
                         }}
                         className={\`flex-shrink-0 w-16 h-16 rounded-[1.25rem] border-2 relative overflow-hidden transition-all group \${selectedUserRefId === ref.id ? 'border-purple-500 ring-2 ring-purple-100 shadow-sm' : 'border-slate-200 hover:border-slate-300'}\`}
                      >
                         <img src={ref.url} className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500" alt="personal ref" />
                         <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent flex items-end justify-center pb-1">
                             <span className="text-white text-[8px] font-bold truncate px-1 w-full text-center capitalize">{ref.category.replace('_', ' ')}</span>
                         </div>
                         {selectedUserRefId === ref.id && (
                           <div className="absolute top-1 right-1 bg-purple-500 text-white p-0.5 rounded-full shadow-sm">
                             <Check size={8} strokeWidth={4} />
                           </div>
                         )}
                      </button>
                 ))}`;

if (!content.includes(normalizedTarget)) {
    console.error("❌ Target not found in normalized content!");
    process.exit(1);
}

content = content.replace(normalizedTarget, replacement);
content = content.replace(/\n/g, '\r\n');

fs.writeFileSync(filePath, content, 'utf8');
console.log("✅ Edit applied successfully!");
