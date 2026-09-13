import SwiftUI

struct ContentView: View {
    var body: some View {
        // PROTOTYPE (prototype/window-chrome): see App/Prototype/WindowChromePrototype.swift.
        #if DEBUG
            WindowChromePrototype()
        #else
            EmptyView()
        #endif
    }
}
